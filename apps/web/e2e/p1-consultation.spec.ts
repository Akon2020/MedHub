import { expect, test, type Browser, type Page } from '@playwright/test';
import { activateDevice, unlock, withServer } from './support';

/**
 * Scenario P1, steps 1 and 3 to 6 (docs/08-parcours-acceptation.md), the J1
 * exit criterion: reception, triage and consultation of a patient without
 * network, then synchronisation without error. The cash desk (step 2) and the
 * laboratory request come with J2.
 */
async function open(browser: Browser, username: string) {
  const context = await browser.newContext({ locale: 'fr-FR', serviceWorkers: 'block' });
  const page = await context.newPage();
  await activateDevice(page, username);
  return { context, page };
}

const synced = (page: Page) =>
  expect
    .poll(() => page.evaluate(() => window.__medhubTest!.sync()), { timeout: 20_000 })
    .toBeNull();

test('scenario P1: reception, triage and consultation offline, then a clean synchronisation', async ({
  browser,
}) => {
  test.setTimeout(5 * 60_000);
  const startedAt = new Date();

  // Test catalogue of the structure (fictitious values for the scenario).
  await withServer(async (client) => {
    for (const [code, inn, atc, strength] of [
      ['E2E-AMOX', 'Amoxicilline', 'J01CA04', '500 mg'],
      ['E2E-AZI', 'Azithromycine', 'J01FA10', '250 mg'],
    ]) {
      await client.query(
        "insert into drug (id, tenant_id, code, inn, atc_code, form, strength, dose_unit) values (gen_random_uuid(), current_setting('app.tenant_id')::uuid, $1, $2, $3, 'gélule', $4, 'mg') on conflict (tenant_id, code) do nothing",
        [code, inn, atc, strength],
      );
    }
  });

  // 1. Reception registers the patient and finds him again despite the spelling.
  const desk = await open(browser, 'accueil');
  await desk.page.goto('/app/patients?new=1');
  await unlock(desk.page);
  await desk.page.getByLabel('Nom', { exact: true }).fill('Moukendi');
  await desk.page.getByLabel('Prénom').fill('Pascal');
  await desk.page.getByLabel('ou âge estimé (ans)').fill('41');
  await desk.page.getByRole('button', { name: 'Enregistrer le patient' }).click();
  await desk.page.waitForURL(/\/app\/patients\/fiche/, { timeout: 20_000 });
  const patientId = new URL(desk.page.url()).searchParams.get('id') ?? '';
  await synced(desk.page);

  // Known allergy, recorded earlier on another workstation.
  await withServer(async (client) => {
    const id = (await client.query<{ id: string }>('select gen_random_uuid() as id')).rows[0]
      ?.id as string;
    await client.query(
      "insert into allergy (id, tenant_id, patient_id, noted_at, status, substance, atc_code, category, severity, certainty) values ($1, current_setting('app.tenant_id')::uuid, $2, now(), 'active', 'Amoxicilline', 'J01CA04', 'drug', 'severe', 'confirmed')",
      [id, patientId],
    );
    await client.query(
      "insert into change_log (tenant_id, entity, entity_id, version, scope_keys) values (current_setting('app.tenant_id')::uuid, 'allergy', $1, 1, $2)",
      [id, [`patient:${patientId}`]],
    );
  });

  await desk.page.goto('/app/patients');
  await unlock(desk.page);
  await desk.page.getByLabel('Nom, téléphone ou numéro de dossier').fill('Mukendi');
  await expect(desk.page.getByText(/Moukendi/).first()).toBeVisible({ timeout: 20_000 });
  await desk.page.goto(`/app/patients/fiche?id=${patientId}`);
  await unlock(desk.page);
  await desk.page.getByLabel('File', { exact: true }).selectOption({ label: 'Accueil · Accueil' });
  await desk.page.getByRole('button', { name: 'Créer la visite et le ticket' }).click();
  await expect(desk.page.getByText(/^A-[A-Z0-9]+-\d{3}$/)).toBeVisible({ timeout: 20_000 });
  await synced(desk.page);
  await desk.context.close();

  // 3 and 4. The triage workstation loses the network; the nurse triages.
  const nurse = await open(browser, 'infirmier');
  await synced(nurse.page);
  await nurse.page.goto(`/app/patients/fiche?id=${patientId}`);
  await unlock(nurse.page);
  await expect(nurse.page.getByText('Triage de la visite du jour')).toBeVisible({
    timeout: 20_000,
  });
  await nurse.context.setOffline(true);
  await nurse.page.getByLabel('Motif principal').fill('Fièvre et toux depuis cinq jours');
  await nurse.page.getByLabel('Orienter vers').selectOption({ label: 'Consultations externes' });
  await nurse.page.getByRole('button', { name: 'Enregistrer le triage' }).click();
  await expect(nurse.page.getByText('Fièvre et toux depuis cinq jours')).toBeVisible({
    timeout: 20_000,
  });
  await nurse.context.setOffline(false);
  await synced(nurse.page);
  await nurse.context.close();

  // 5. The physician opens the consultation, then works without network.
  const doctor = await open(browser, 'medecin');
  await synced(doctor.page);
  await doctor.page.goto(`/app/patients/fiche?id=${patientId}`);
  await unlock(doctor.page);
  await doctor.page.getByRole('link', { name: 'Consulter' }).click();
  await doctor.page.waitForURL(/\/app\/consultation\?patient=/, { timeout: 20_000 });
  await expect(doctor.page.getByText(/Amoxicilline/).first()).toBeVisible({ timeout: 20_000 });
  await doctor.context.setOffline(true);

  await doctor.page.getByRole('button', { name: 'Ajouter une ligne' }).click();
  await doctor.page.getByLabel('Médicament (catalogue ou texte libre)').fill('Amox');
  await doctor.page.getByRole('button', { name: /Amoxicilline 500 mg/ }).click();
  await doctor.page.getByLabel('Dose', { exact: true }).fill('500');
  await doctor.page.getByLabel('Durée (jours)').fill('7');
  await expect(doctor.page.getByText(/Bloquant : allergie connue : Amoxicilline/)).toBeVisible();
  await expect(doctor.page.getByRole('button', { name: 'Signer l’ordonnance' })).toBeDisabled();

  // He chooses another antibiotic.
  await doctor.page.getByRole('button', { name: 'Retirer la ligne' }).click();
  await doctor.page.getByRole('button', { name: 'Ajouter une ligne' }).click();
  await doctor.page.getByLabel('Médicament (catalogue ou texte libre)').fill('Azith');
  await doctor.page.getByRole('button', { name: /Azithromycine 250 mg/ }).click();
  await doctor.page.getByLabel('Dose', { exact: true }).fill('500');
  await doctor.page.getByLabel('Fréquence').selectOption('1x/d');
  await doctor.page.getByLabel('Durée (jours)').fill('3');
  await expect(doctor.page.getByText(/Bloquant/)).toHaveCount(0);
  await doctor.page.getByRole('button', { name: 'Signer l’ordonnance' }).click();
  await expect(doctor.page.getByText('Ordonnance signée.')).toBeVisible({ timeout: 20_000 });

  await doctor.page.getByLabel('Motif', { exact: true }).fill('Fièvre et toux');
  await doctor.page.getByLabel('Conclusion').fill('Infection respiratoire basse probable');
  await doctor.page.getByRole('button', { name: 'Signer la note' }).click();
  await expect(doctor.page.getByText('Note signée.')).toBeVisible({ timeout: 20_000 });

  // 6. The network comes back: automatic synchronisation, nothing rejected.
  await doctor.context.setOffline(false);
  await synced(doctor.page);

  const server = await withServer(async (client) => {
    const triage = await client.query<{ complaint: string }>(
      'select chief_complaint as complaint from triage where patient_id = $1',
      [patientId],
    );
    const notes = await client.query<{ n: string; signed: boolean }>(
      'select count(*)::text as n, bool_and(signed_operation is not null) as signed from clinical_note where patient_id = $1',
      [patientId],
    );
    const items = await client.query<{ label: string; frequency: string }>(
      'select i.label, i.frequency from prescription_item i join prescription p on p.id = i.prescription_id where p.patient_id = $1',
      [patientId],
    );
    const rejected = await client.query<{ n: string }>(
      "select count(*)::text as n from op_log where status = 'rejected' and received_at >= $1 and (entity_id = $2 or payload->>'patientId' = $2::text)",
      [startedAt, patientId],
    );
    const status = await client.query<{ status: string }>(
      'select status from encounter where patient_id = $1',
      [patientId],
    );
    return {
      triage: triage.rows.map((r) => r.complaint),
      notes: Number(notes.rows[0]?.n ?? 0),
      signed: notes.rows[0]?.signed ?? false,
      items: items.rows,
      rejected: Number(rejected.rows[0]?.n ?? 0),
      visit: status.rows.map((r) => r.status),
    };
  });
  expect(server.triage).toEqual(['Fièvre et toux depuis cinq jours']);
  expect(server.notes).toBe(1);
  expect(server.signed).toBe(true);
  expect(server.items).toEqual([{ label: 'Azithromycine 250 mg gélule', frequency: '1x/d' }]);
  expect(server.visit).toEqual(['in_consultation']);
  expect(server.rejected).toBe(0);
  await doctor.context.close();
});
