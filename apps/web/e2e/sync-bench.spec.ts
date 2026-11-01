import { readFileSync } from 'node:fs';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { activateDevice, tenantCode, unlock, withServer } from './support';

/**
 * J0 exit criterion (docs/02-offline-sync.md section 13): 500 operations on two
 * real browsers with random outages, including responses lost after the server
 * committed. Expect zero loss, zero duplicate, converged databases and no
 * patient name in clear inside IndexedDB.
 */
const TOTAL_OPS = 500;
const FAMILY_NAMES = [
  'Ilunga',
  'Kabwela',
  'Mbuyamba',
  'Tshibanda',
  'Lukusa',
  'Nzuzimbi',
  'Kasongo',
  'Mwambayi',
];

type Device = {
  context: BrowserContext;
  page: Page;
  offline: boolean;
  loseResponses: boolean;
  stats: { lost: number; failedSyncs: number; relocks: number };
};

function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function openDevice(
  browser: import('@playwright/test').Browser,
  username: string,
): Promise<Device> {
  const context = await browser.newContext({ locale: 'fr-FR', serviceWorkers: 'block' });
  const page = await context.newPage();
  const device: Device = {
    context,
    page,
    offline: false,
    loseResponses: false,
    stats: { lost: 0, failedSyncs: 0, relocks: 0 },
  };
  // Lost acknowledgement: the request reaches the server and is committed, the answer never arrives.
  await page.route('**/api/v1/sync/push', async (route) => {
    if (!device.loseResponses) return route.continue();
    try {
      await route.fetch();
      device.stats.lost += 1;
    } catch {
      // The forwarded request itself was cut (keep-alive socket closed): for the
      // device it is one more failed push, which the bench is about anyway.
    }
    await route.abort('failed');
  });
  await activateDevice(page, username);
  return device;
}

/**
 * A workstation can lock itself (inactivity, closed session): the user simply
 * types the PIN again. Data integrity is checked on the server, not here.
 */
async function ensureReady(device: Device): Promise<void> {
  if (await device.page.evaluate(() => window.__medhubTest !== undefined)) return;
  if (await device.page.getByRole('button', { name: 'Déverrouiller' }).isVisible()) {
    device.stats.relocks += 1;
    await unlock(device.page);
    return;
  }
  await device.page.waitForFunction(() => window.__medhubTest !== undefined, undefined, {
    timeout: 30_000,
  });
}

async function setNetwork(device: Device, random: () => number): Promise<void> {
  await ensureReady(device);
  // Keyboard activity keeps the five-minute auto-lock from closing the session mid-bench.
  await device.page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown')));
  device.offline = random() < 0.35;
  device.loseResponses = !device.offline && random() < 0.4;
  await device.context.setOffline(device.offline);
}

/**
 * The failed offline navigation of the form may still be running (Next.js
 * retries it as a full page load): a goto interrupted by it is simply retried.
 */
async function gotoSettled(page: Page, url: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await page.goto(url);
      return;
    } catch (error) {
      if (attempt >= 2 || !String(error).includes('ERR_ABORTED')) throw error;
      await page.waitForTimeout(500);
    }
  }
}

async function sync(device: Device): Promise<void> {
  await ensureReady(device);
  const error = await device.page.evaluate(() => window.__medhubTest!.sync());
  if (error !== null) device.stats.failedSyncs += 1;
}

type Snapshot = Map<string, number>;

async function localSnapshot(page: Page, entity: string): Promise<Snapshot> {
  const rows = await page.evaluate((name) => window.__medhubTest!.entities(name), entity);
  return new Map(rows.map((r) => [r.id, r.version]));
}

test('two browsers, 500 operations, outages and lost responses: no loss, no duplicate, convergence', async ({
  browser,
}) => {
  test.setTimeout(10 * 60_000);
  const random = prng(29_10_2026);
  const front = await openDevice(browser, 'accueil');
  const nurse = await openDevice(browser, 'infirmier');
  const frontId = await front.page.evaluate(() => window.__medhubTest!.deviceId);
  const nurseId = await nurse.page.evaluate(() => window.__medhubTest!.deviceId);
  const frontCode = await front.page.evaluate(() => window.__medhubTest!.deviceCode);

  let registers = 0;
  let updates = 0;
  let vitals = 0;
  let frontPatients: string[] = [];
  let nursePatients: string[] = [];

  for (let i = 0; registers + updates + vitals < TOTAL_OPS; i += 1) {
    if (i % 25 === 0) {
      await setNetwork(front, random);
      await setNetwork(nurse, random);
      frontPatients = [...(await localSnapshot(front.page, 'patient')).keys()];
      nursePatients = [...(await localSnapshot(nurse.page, 'patient')).keys()];
    }
    const useNurse = random() < 0.45;
    await ensureReady(useNurse ? nurse : front);
    if (useNurse) {
      if (nursePatients.length === 0) {
        await sync(nurse);
        nursePatients = [...(await localSnapshot(nurse.page, 'patient')).keys()];
      } else {
        const patientId = nursePatients[Math.floor(random() * nursePatients.length)] as string;
        const value = Math.round((36 + random() * 3.5) * 10) / 10;
        await nurse.page.evaluate(
          ([pid, v]) =>
            window.__medhubTest!.dispatch('vital_sign.record', {
              patientId: pid as string,
              code: 'temp',
              value: v as number,
              unit: '°C',
              measuredAt: new Date().toISOString(),
            }),
          [patientId, value] as const,
        );
        vitals += 1;
      }
    } else {
      if (frontPatients.length > 0 && random() < 0.3) {
        const patientId = frontPatients[Math.floor(random() * frontPatients.length)] as string;
        const phone = `+243 81 ${Math.floor(random() * 9_000_000 + 1_000_000)}`;
        await front.page.evaluate(
          ([pid, p]) =>
            window.__medhubTest!.dispatch('patient.update', { phone: p }, { entityId: pid }),
          [patientId, phone] as const,
        );
        updates += 1;
      } else {
        const familyName = FAMILY_NAMES[Math.floor(random() * FAMILY_NAMES.length)] as string;
        const created = await front.page.evaluate(
          ([mrn, name, sex]) =>
            window.__medhubTest!.dispatch('patient.register', {
              mrn,
              familyName: name,
              sex: sex as 'F' | 'M',
              birthDateEstimated: false,
              sensitivity: 'normal',
            }),
          [`E2E-${frontCode}-${i}`, familyName, random() < 0.5 ? 'F' : 'M'] as const,
        );
        frontPatients.push(created.entityId);
        registers += 1;
      }
    }
    if (random() < 0.2) await sync(useNurse ? nurse : front);
  }

  // Back online: sync until both outboxes are empty and nothing moves anymore.
  for (const device of [front, nurse]) {
    device.offline = false;
    device.loseResponses = false;
    await device.context.setOffline(false);
  }
  for (let round = 0; round < 4; round += 1) {
    await sync(front);
    await sync(nurse);
  }
  expect(await front.page.evaluate(() => window.__medhubTest!.pending())).toBe(0);
  expect(await nurse.page.evaluate(() => window.__medhubTest!.pending())).toBe(0);

  const server = await withServer(async (client) => {
    const ops = await client.query<{ status: string; n: string }>(
      'select status, count(*)::text as n from op_log where device_id = any($1) group by status',
      [[frontId, nurseId]],
    );
    const dup = await client.query<{ n: string }>(
      'select count(*)::text as n from (select op_id from op_log group by op_id having count(*) > 1) d',
    );
    const created = await client.query<{ n: string }>(
      'select count(*)::text as n from patient where device_id = $1',
      [frontId],
    );
    const recorded = await client.query<{ n: string }>(
      'select count(*)::text as n from vital_sign where device_id = $1',
      [nurseId],
    );
    const patients = await client.query<{ id: string; version: number }>(
      'select id, version from patient',
    );
    const vitalRows = await client.query<{ id: string; version: number }>(
      'select id, version from vital_sign',
    );
    return {
      byStatus: Object.fromEntries(ops.rows.map((r) => [r.status, Number(r.n)])),
      duplicates: Number(dup.rows[0]?.n ?? 0),
      createdPatients: Number(created.rows[0]?.n ?? 0),
      recordedVitals: Number(recorded.rows[0]?.n ?? 0),
      patients: new Map(patients.rows.map((r) => [r.id, r.version])),
      vitals: new Map(vitalRows.rows.map((r) => [r.id, r.version])),
    };
  });

  // Zero loss and zero duplicate: every dispatched operation is in op_log exactly once.
  const accepted = (server.byStatus.applied ?? 0) + (server.byStatus.merged ?? 0);
  expect(server.byStatus.rejected ?? 0).toBe(0);
  expect(accepted + (server.byStatus.needs_review ?? 0)).toBe(registers + updates + vitals);
  expect(server.duplicates).toBe(0);
  expect(server.createdPatients).toBe(registers);
  expect(server.recordedVitals).toBe(vitals);

  // Convergence: both browsers hold exactly the server state they are allowed to read.
  expect(await localSnapshot(front.page, 'patient')).toEqual(server.patients);
  expect(await localSnapshot(nurse.page, 'patient')).toEqual(server.patients);
  expect(await localSnapshot(nurse.page, 'vital_sign')).toEqual(server.vitals);

  // Encryption at rest: no patient name in clear anywhere in IndexedDB.
  for (const device of [front, nurse]) {
    const dump = await device.page.evaluate(() => window.__medhubTest!.rawDump());
    for (const name of FAMILY_NAMES) expect(dump).not.toContain(name);
  }

  const lost = front.stats.lost + nurse.stats.lost;
  const failed = front.stats.failedSyncs + nurse.stats.failedSyncs;
  const relocks = front.stats.relocks + nurse.stats.relocks;
  console.warn(
    `e2e bench: ${registers + updates + vitals} ops (${registers} registrations, ${updates} updates, ${vitals} vital signs), ` +
      `${failed} failed sync cycles, ${lost} lost push responses, ${relocks} PIN re-entries`,
  );
  expect(lost).toBeGreaterThan(0);
  expect(failed).toBeGreaterThan(0);

  await front.context.close();
  await nurse.context.close();
});

test('front desk registers a patient offline from the screen, then it syncs', async ({
  browser,
}) => {
  test.setTimeout(3 * 60_000);
  const { page, context } = await openDevice(browser, 'accueil');
  const deviceId = await page.evaluate(() => window.__medhubTest!.deviceId);
  await page.goto('/app/patients?new=1');
  await unlock(page);

  await context.setOffline(true);
  await page.getByLabel('Nom', { exact: true }).fill('Kabwela');
  await page.getByLabel('Prénom').fill('Espoir');
  await page.getByLabel('ou âge estimé (ans)').fill('41');
  // The form only navigates to the record once the write is committed to the
  // encrypted outbox: that request (failing offline) proves the save happened.
  const committed = page.waitForRequest((r) => r.url().includes('/app/patients/fiche'), {
    timeout: 15_000,
  });
  await page.getByRole('button', { name: 'Enregistrer le patient' }).click();
  await committed;

  // In development there is no service worker, so the record page cannot load
  // offline: the patient must survive that failed navigation and a full reload,
  // then reach the server.
  await context.setOffline(false);
  await gotoSettled(page, '/app');
  await unlock(page);
  await expect
    .poll(() => page.evaluate(() => window.__medhubTest!.sync()), { timeout: 20_000 })
    .toBeNull();
  expect(await page.evaluate(() => window.__medhubTest!.pending())).toBe(0);

  const stored = await withServer(async (client) => {
    const { rows } = await client.query<{ n: string }>(
      "select count(*)::text as n from patient where device_id = $1 and family_name = 'Kabwela' and given_name = 'Espoir'",
      [deviceId],
    );
    return Number(rows[0]?.n ?? 0);
  });
  expect(stored).toBe(1);

  // Registering the same person again shows the existing record before creating anything.
  await page.goto('/app/patients?new=1');
  await unlock(page);
  await page.getByLabel('Nom', { exact: true }).fill('Kabwela');
  await page.getByLabel('Prénom').fill('Espoir');
  await page.getByLabel('ou âge estimé (ans)').fill('41');
  await page.getByRole('button', { name: 'Enregistrer le patient' }).click();
  await expect(
    page.getByRole('heading', { name: 'Un patient semblable est déjà enregistré' }),
  ).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByRole('link', { name: 'Ouvrir ce dossier' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: "Ce n'est aucun d'eux : enregistrer" }),
  ).toBeVisible();
  expect(await page.evaluate(() => window.__medhubTest!.pending())).toBe(0);

  // The record is completed offline, then the changes reach the server with their history.
  const patientId = await withServer(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      "select id from patient where device_id = $1 and family_name = 'Kabwela' and given_name = 'Espoir'",
      [deviceId],
    );
    return rows[0]?.id ?? '';
  });
  await page.goto(`/app/patients/fiche?id=${patientId}`);
  await unlock(page);
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Compléter ou corriger' }).click();
  await page.getByLabel('Profession').fill('Enseignante');
  await page.getByLabel('Nom de la mère').fill('Mwamba Thérèse');
  await page.getByLabel('Commune').fill('Lemba');
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.getByText(/Identité enregistrée/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Enseignante')).toBeVisible();
  await context.setOffline(false);
  await expect
    .poll(() => page.evaluate(() => window.__medhubTest!.sync()), { timeout: 20_000 })
    .toBeNull();
  const completed = await withServer(async (client) => {
    const row = await client.query<{ occupation: string; mother: string; commune: string }>(
      "select occupation, mother_name as mother, address->>'commune' as commune from patient where id = $1",
      [patientId],
    );
    const fields = await client.query<{ field: string }>(
      'select field from patient_field_history where patient_id = $1 order by field',
      [patientId],
    );
    return { ...row.rows[0], fields: fields.rows.map((r) => r.field) };
  });
  expect(completed).toEqual({
    occupation: 'Enseignante',
    mother: 'Mwamba Thérèse',
    commune: 'Lemba',
    fields: ['address', 'motherName', 'occupation'],
  });

  // Patient card: a PDF with an opaque QR token, then the token found again as a scanner types it.
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Imprimer la carte' }).click();
  const card = await downloading;
  expect(card.suggestedFilename()).toMatch(/^carte-.+\.pdf$/);
  expect(
    readFileSync(await card.path())
      .subarray(0, 5)
      .toString(),
  ).toBe('%PDF-');
  await expect
    .poll(() => page.evaluate(() => window.__medhubTest!.sync()), { timeout: 20_000 })
    .toBeNull();
  const token = await withServer(async (client) => {
    const { rows } = await client.query<{ token: string | null }>(
      'select card_token as token from patient where id = $1',
      [patientId],
    );
    return rows[0]?.token ?? '';
  });
  expect(token).toMatch(/^MHC1-[A-Z0-9]{20}$/);
  await page.goto('/app/patients');
  await unlock(page);
  await page.getByPlaceholder('Nom, téléphone ou numéro de dossier').fill(token);
  await page.waitForURL((u) => u.searchParams.get('id') === patientId, { timeout: 20_000 });
  await context.close();
});

test('an unknown patient is registered offline, identified, then the physician records the death', async ({
  browser,
}) => {
  test.setTimeout(3 * 60_000);
  const desk = await openDevice(browser, 'accueil');
  const deskDevice = await desk.page.evaluate(() => window.__medhubTest!.deviceId);
  await desk.page.goto('/app/patients?new=1');
  await unlock(desk.page);

  await desk.context.setOffline(true);
  await desk.page.getByRole('button', { name: 'Inconnu', exact: true }).click();
  await desk.page.getByRole('button', { name: 'Homme', exact: true }).click();
  await desk.page.getByLabel('ou âge estimé (ans)').fill('30');
  const committed = desk.page.waitForRequest((r) => r.url().includes('/app/patients/fiche'), {
    timeout: 15_000,
  });
  await desk.page.getByRole('button', { name: 'Enregistrer le patient' }).click();
  await committed;
  await desk.context.setOffline(false);
  await gotoSettled(desk.page, '/app');
  await unlock(desk.page);
  await expect
    .poll(() => desk.page.evaluate(() => window.__medhubTest!.sync()), { timeout: 20_000 })
    .toBeNull();
  const unknown = await withServer(async (client) => {
    const { rows } = await client.query<{ id: string; name: string; kind: string }>(
      "select id, family_name as name, provisional_kind as kind from patient where device_id = $1 and is_provisional and family_name like 'Inconnu homme 30 ans environ%'",
      [deskDevice],
    );
    return rows[0];
  });
  expect(unknown?.kind).toBe('unknown');
  const patientId = unknown?.id ?? '';

  // Offline again: the desk marks a favourite and identifies the patient.
  await desk.page.goto(`/app/patients/fiche?id=${patientId}`);
  await unlock(desk.page);
  await expect(desk.page.getByText('Dossier provisoire')).toBeVisible();
  await desk.context.setOffline(true);
  await desk.page.getByRole('button', { name: 'Ajouter aux favoris' }).click();
  await expect(desk.page.getByRole('button', { name: 'Favori', exact: true })).toBeVisible();
  await desk.page.getByRole('button', { name: 'Identifier le patient' }).click();
  await desk.page.locator('#identity-familyName').fill('Lufuluabo');
  await desk.page.locator('#identity-givenName').fill('Pascal');
  await desk.page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(desk.page.getByText(/Identité enregistrée/)).toBeVisible({ timeout: 20_000 });
  await expect(desk.page.getByText('Dossier provisoire')).toBeHidden();
  await desk.context.setOffline(false);
  await expect
    .poll(() => desk.page.evaluate(() => window.__medhubTest!.sync()), { timeout: 20_000 })
    .toBeNull();
  const identified = await withServer(async (client) => {
    const patient = await client.query<{ name: string; provisional: boolean }>(
      'select family_name as name, is_provisional as provisional from patient where id = $1',
      [patientId],
    );
    const favorite = await client.query<{ active: boolean }>(
      'select active from patient_favorite where patient_id = $1',
      [patientId],
    );
    return { ...patient.rows[0], favorites: favorite.rows.map((r) => r.active) };
  });
  expect(identified).toEqual({ name: 'Lufuluabo', provisional: false, favorites: [true] });
  await desk.context.close();

  // The physician, offline, records the death: no new vital sign can follow.
  const doctor = await openDevice(browser, 'medecin');
  await expect
    .poll(() => doctor.page.evaluate(() => window.__medhubTest!.sync()), { timeout: 20_000 })
    .toBeNull();
  await doctor.page.goto(`/app/patients/fiche?id=${patientId}`);
  await unlock(doctor.page);
  await expect(
    doctor.page.getByRole('button', { name: 'Enregistrer une constante' }),
  ).toBeVisible();
  await doctor.context.setOffline(true);
  await doctor.page.getByRole('button', { name: 'Déclarer le décès' }).click();
  await doctor.page.getByRole('button', { name: 'Confirmer le décès' }).click();
  await expect(doctor.page.getByText(/^Décédé le/)).toBeVisible({ timeout: 20_000 });
  await expect(doctor.page.getByRole('button', { name: 'Enregistrer une constante' })).toBeHidden();
  await doctor.context.setOffline(false);
  await expect
    .poll(() => doctor.page.evaluate(() => window.__medhubTest!.sync()), { timeout: 20_000 })
    .toBeNull();
  const deceased = await withServer(async (client) => {
    const { rows } = await client.query<{ at: Date | null }>(
      'select deceased_at as at from patient where id = $1',
      [patientId],
    );
    return rows[0]?.at ?? null;
  });
  expect(deceased).not.toBeNull();
  await doctor.context.close();
});

test('arrival, call and triage offline across two workstations, then an appointment', async ({
  browser,
}) => {
  test.setTimeout(4 * 60_000);
  const desk = await openDevice(browser, 'accueil');
  await desk.page.goto('/app/patients?new=1');
  await unlock(desk.page);
  await desk.page.getByLabel('Nom', { exact: true }).fill('Ngalula');
  await desk.page.getByLabel('Prénom').fill('Bénédicte');
  await desk.page.getByLabel('ou âge estimé (ans)').fill('34');
  await desk.page.getByRole('button', { name: 'Enregistrer le patient' }).click();
  await desk.page.waitForURL(/\/app\/patients\/fiche/, { timeout: 20_000 });
  const patientId = new URL(desk.page.url()).searchParams.get('id') ?? '';
  await expect
    .poll(() => desk.page.evaluate(() => window.__medhubTest!.sync()), { timeout: 20_000 })
    .toBeNull();

  // Arrival offline: the visit and the ticket of the reception queue.
  await desk.context.setOffline(true);
  await desk.page.getByLabel('File', { exact: true }).selectOption({ label: 'Accueil · Accueil' });
  await desk.page.getByRole('button', { name: 'Créer la visite et le ticket' }).click();
  const ticket = desk.page.getByText(/^A-[A-Z0-9]+-001$/);
  await expect(ticket).toBeVisible({ timeout: 20_000 });
  const number = (await ticket.textContent()) ?? '';
  await desk.context.setOffline(false);
  await expect
    .poll(() => desk.page.evaluate(() => window.__medhubTest!.sync()), { timeout: 20_000 })
    .toBeNull();

  // The nurse, offline, calls the ticket, triages and sends the patient to consultation.
  const nurse = await openDevice(browser, 'infirmier');
  await expect
    .poll(() => nurse.page.evaluate(() => window.__medhubTest!.sync()), { timeout: 20_000 })
    .toBeNull();
  await nurse.page.goto('/app/files');
  await unlock(nurse.page);
  await nurse.page.getByLabel('File', { exact: true }).selectOption({ label: 'Accueil' });
  await nurse.page.getByLabel('Salle de ce poste').fill('Triage');
  await nurse.context.setOffline(true);
  const row = nurse.page.getByRole('listitem').filter({ hasText: number });
  await row.getByRole('button', { name: 'Appeler' }).click();
  await expect(
    nurse.page.getByRole('listitem').filter({ hasText: number }).getByText('Appelé'),
  ).toBeVisible();
  // Without a service worker in this bench, a new page cannot load offline: the
  // record is opened online, then the triage itself is done offline.
  await nurse.context.setOffline(false);
  await gotoSettled(nurse.page, `/app/patients/fiche?id=${patientId}`);
  await unlock(nurse.page);
  await expect(nurse.page.getByText('Triage de la visite du jour')).toBeVisible({
    timeout: 20_000,
  });
  await nurse.context.setOffline(true);
  await nurse.page.getByLabel('Motif principal').fill('Céphalées depuis trois jours');
  await nurse.page.getByLabel('Orienter vers').selectOption({ label: 'Consultations externes' });
  await nurse.page.getByRole('button', { name: 'Enregistrer le triage' }).click();
  await expect(nurse.page.getByText('Céphalées depuis trois jours')).toBeVisible({
    timeout: 20_000,
  });
  await nurse.context.setOffline(false);
  await expect
    .poll(() => nurse.page.evaluate(() => window.__medhubTest!.sync()), { timeout: 20_000 })
    .toBeNull();

  const server = await withServer(async (client) => {
    const tickets = await client.query<{ number: string; status: string; room: string | null }>(
      'select number, status, room from queue_ticket where patient_id = $1 order by issued_at, number',
      [patientId],
    );
    const triage = await client.query<{ complaint: string }>(
      'select chief_complaint as complaint from triage where patient_id = $1',
      [patientId],
    );
    const visits = await client.query<{ n: string }>(
      'select count(*)::text as n from encounter where patient_id = $1',
      [patientId],
    );
    return {
      tickets: tickets.rows,
      triage: triage.rows.map((r) => r.complaint),
      visits: Number(visits.rows[0]?.n ?? 0),
    };
  });
  expect(server.visits).toBe(1);
  expect(server.triage).toEqual(['Céphalées depuis trois jours']);
  expect(server.tickets).toHaveLength(2);
  expect(server.tickets.find((t) => t.number === number)).toMatchObject({
    status: 'done',
    room: 'Triage',
  });
  expect(server.tickets.find((t) => t.number !== number)).toMatchObject({ status: 'waiting' });

  // The waiting-room screen shows numbers, never names.
  const queueId = await withServer(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      "select q.id from queue q join tenant t on t.id = q.tenant_id where t.code = $1 and q.code = 'CONS'",
      [tenantCode()],
    );
    return rows[0]?.id ?? '';
  });
  await nurse.page.goto('/app/files');
  await unlock(nurse.page);
  await nurse.page
    .getByLabel('File', { exact: true })
    .selectOption({ label: 'Consultations externes' });
  const consult = nurse.page.getByRole('listitem').filter({ hasText: /^C-/ }).first();
  const consultNumber = ((await consult.locator('span').first().textContent()) ?? '').trim();
  await consult.getByRole('button', { name: 'Appeler' }).click();
  await nurse.page.goto(`/app/ecran-appel?queue=${queueId}`);
  await unlock(nurse.page);
  await expect(nurse.page.getByText(consultNumber, { exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await expect(nurse.page.getByText('Ngalula')).toBeHidden();
  await nurse.context.close();

  // Back at the desk, offline: an appointment on the first free slot of the physician.
  await desk.page.goto(`/app/rendez-vous?patient=${patientId}`);
  await unlock(desk.page);
  await desk.context.setOffline(true);
  await desk.page.getByRole('button', { name: 'Premier créneau libre' }).click();
  await desk.page.getByRole('button', { name: 'Réserver' }).first().click();
  await expect(desk.page.getByText('Rendez-vous enregistré.')).toBeVisible({ timeout: 20_000 });
  await desk.context.setOffline(false);
  await expect
    .poll(() => desk.page.evaluate(() => window.__medhubTest!.sync()), { timeout: 20_000 })
    .toBeNull();
  const booked = await withServer(async (client) => {
    const { rows } = await client.query<{ status: string }>(
      'select status from appointment where patient_id = $1',
      [patientId],
    );
    return rows.map((r) => r.status);
  });
  expect(booked).toEqual(['booked']);
  await desk.context.close();
});
