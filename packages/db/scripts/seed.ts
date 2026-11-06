import { randomBytes } from 'node:crypto';
import { consultationGeneral } from '@medhub/forms';
import { ROLE_TEMPLATES, uuidv7 } from '@medhub/shared';
import { and, eq } from 'drizzle-orm';
import { appendAudit } from '../src/audit';
import { createDb } from '../src/client';
import { withSystem, withTenant } from '../src/context';
import { hashPassword } from '../src/password';
import {
  appointmentType,
  department,
  formDefinition,
  formVersion,
  queue,
  role,
  rolePermission,
  scheduleTemplate,
  site,
  tenant,
  userAccount,
  userRole,
} from '../src/schema';
import { isMainModule, requireEnv } from './env';

/**
 * Fictitious demonstration structure (docs/00-cadrage.md section 7). Every name
 * here is invented; never load real patient or staff data in a seed.
 */
const DEMO_TENANT = {
  code: 'HOP-DEM-0001',
  legalName: 'Hôpital Pilote Démo',
  displayName: 'Hôpital Pilote Démo',
  type: 'hospital',
};

const DEMO_USERS: {
  username: string;
  displayName: string;
  title: string | null;
  roles: string[];
}[] = [
  {
    username: 'admin',
    displayName: 'Administrateur Démo',
    title: null,
    roles: ['tenant_admin', 'director'],
  },
  { username: 'accueil', displayName: 'Bienvenu Accueil', title: null, roles: ['receptionist'] },
  { username: 'infirmier', displayName: 'Espérance Soins', title: 'Inf.', roles: ['nurse'] },
  { username: 'medecin', displayName: 'Dieudonné Kasongo', title: 'Dr', roles: ['physician'] },
  { username: 'pharmacie', displayName: 'Patience Lukusa', title: 'Ph.', roles: ['pharmacist'] },
  { username: 'caisse', displayName: 'Héritier Mwamba', title: null, roles: ['cashier'] },
  { username: 'direction', displayName: 'Sagesse Direction', title: null, roles: ['director'] },
  { username: 'laboratoire', displayName: 'Fidèle Analyses', title: 'Tech.', roles: ['lab_tech'] },
];

export type SeedTenant = typeof DEMO_TENANT;

/** Fictitious departments of the demo site. */
const DEMO_DEPARTMENTS = [
  { code: 'ACC', name: 'Accueil', kind: 'administrative' },
  { code: 'CONS', name: 'Consultations externes', kind: 'clinical' },
  { code: 'LAB', name: 'Laboratoire', kind: 'laboratory' },
  { code: 'PHAR', name: 'Pharmacie', kind: 'pharmacy' },
  { code: 'CAIS', name: 'Caisse', kind: 'cashier' },
];

const DEMO_QUEUES = [
  { code: 'ACC', name: 'Accueil', ticketPrefix: 'A', department: 'ACC' },
  { code: 'CONS', name: 'Consultations externes', ticketPrefix: 'C', department: 'CONS' },
];

export async function seedDemo(
  url: string,
  password: string,
  structure: SeedTenant = DEMO_TENANT,
): Promise<{ tenantId: string }> {
  const { pool, db } = createDb(url, 2);
  try {
    const existing = await withSystem(db, (tx) =>
      tx.select().from(tenant).where(eq(tenant.code, structure.code)),
    );
    const tenantId = existing[0]?.id ?? uuidv7();
    if (!existing[0]) {
      await withSystem(db, (tx) =>
        tx.insert(tenant).values({ id: tenantId, ...structure, status: 'active' }),
      );
    }

    const passwordHash = await hashPassword(password);

    await withTenant(db, { tenantId, userId: null }, async (tx) => {
      const [kin] = await tx.select().from(site).where(eq(site.code, 'KIN'));
      const siteId = kin?.id ?? uuidv7();
      if (!kin) {
        await tx.insert(site).values({
          id: siteId,
          tenantId,
          code: 'KIN',
          name: 'Site principal Kinshasa',
          address: { province: 'Kinshasa', commune: 'Gombe' },
        });
      }

      for (const d of DEMO_DEPARTMENTS) {
        await tx
          .insert(department)
          .values({ id: uuidv7(), tenantId, siteId, ...d })
          .onConflictDoNothing();
      }

      const roleIds = new Map<string, string>();
      for (const template of ROLE_TEMPLATES) {
        const [found] = await tx.select().from(role).where(eq(role.code, template.code));
        const roleId = found?.id ?? uuidv7();
        roleIds.set(template.code, roleId);
        if (!found) {
          await tx.insert(role).values({
            id: roleId,
            tenantId,
            code: template.code,
            name: template.name.fr,
            isPrivileged: template.isPrivileged,
            requiresMfa: template.requiresMfa,
            templateCode: template.code,
          });
        }
        for (const key of template.permissions) {
          await tx
            .insert(rolePermission)
            .values({ tenantId, roleId, permissionKey: key, scope: 'tenant' })
            .onConflictDoNothing();
        }
      }

      for (const user of DEMO_USERS) {
        const [found] = await tx
          .select()
          .from(userAccount)
          .where(eq(userAccount.username, user.username));
        const userId = found?.id ?? uuidv7();
        if (!found) {
          await tx.insert(userAccount).values({
            id: userId,
            tenantId,
            username: user.username,
            displayName: user.displayName,
            title: user.title,
            passwordHash,
            defaultSiteId: siteId,
          });
          await appendAudit(tx, {
            tenantId,
            userId: null,
            action: 'create',
            entity: 'user_account',
            entityId: userId,
            reason: 'seed',
          });
        } else {
          await tx.update(userAccount).set({ passwordHash }).where(eq(userAccount.id, userId));
        }
        for (const code of user.roles) {
          const roleId = roleIds.get(code);
          if (!roleId) continue;
          const [link] = await tx
            .select()
            .from(userRole)
            .where(and(eq(userRole.userId, userId), eq(userRole.roleId, roleId)));
          if (!link)
            await tx.insert(userRole).values({ id: uuidv7(), tenantId, userId, roleId, siteId });
        }
      }

      // Reception setup (S7): two queues, one appointment type, the physician's agenda.
      const departments = await tx.select().from(department).where(eq(department.siteId, siteId));
      const departmentId = (code: string) => departments.find((d) => d.code === code)?.id ?? null;
      for (const q of DEMO_QUEUES) {
        await tx
          .insert(queue)
          .values({
            id: uuidv7(),
            tenantId,
            siteId,
            departmentId: departmentId(q.department),
            code: q.code,
            name: q.name,
            ticketPrefix: q.ticketPrefix,
          })
          .onConflictDoNothing();
      }
      await tx
        .insert(appointmentType)
        .values({
          id: uuidv7(),
          tenantId,
          code: 'CONS',
          name: 'Consultation',
          durationMin: 15,
          departmentId: departmentId('CONS'),
        })
        .onConflictDoNothing();
      const [physician] = await tx
        .select({ id: userAccount.id })
        .from(userAccount)
        .where(eq(userAccount.username, 'medecin'));
      if (physician) {
        const existing = await tx
          .select({ id: scheduleTemplate.id })
          .from(scheduleTemplate)
          .where(eq(scheduleTemplate.resourceId, physician.id));
        if (existing.length === 0) {
          await tx.insert(scheduleTemplate).values(
            [1, 2, 3, 4, 5].map((weekday) => ({
              id: uuidv7(),
              tenantId,
              resourceKind: 'practitioner',
              resourceId: physician.id,
              weekday,
              startTime: '08:00',
              endTime: '12:00',
              slotMin: 15,
              overbookMax: 1,
            })),
          );
        }
      }

      // The general consultation template, published, so a consultation can be filled at once.
      const [form] = await tx
        .select({ id: formDefinition.id })
        .from(formDefinition)
        .where(eq(formDefinition.code, consultationGeneral.code));
      if (!form) {
        const formId = uuidv7();
        await tx.insert(formDefinition).values({
          id: formId,
          tenantId,
          code: consultationGeneral.code,
          step: consultationGeneral.step,
          title: consultationGeneral.title,
        });
        await tx.insert(formVersion).values({
          id: uuidv7(),
          tenantId,
          formDefinitionId: formId,
          version: 1,
          definition: consultationGeneral as unknown as Record<string, unknown>,
          status: 'published',
          publishedAt: new Date(),
        });
      }
    });
    return { tenantId };
  } finally {
    await pool.end();
  }
}

const isMain = isMainModule(import.meta.url);
if (isMain) {
  const url = requireEnv('DATABASE_URL');
  let password = process.env.MEDHUB_SEED_PASSWORD;
  if (!password) {
    password = randomBytes(12).toString('base64url');
    console.warn(
      `MEDHUB_SEED_PASSWORD absent : mot de passe généré pour les comptes de démonstration : ${password}`,
    );
  }
  // --tenant CODE seeds an additional fictitious structure (used by the end-to-end bench).
  const flag = process.argv.indexOf('--tenant');
  const code = flag > 0 ? process.argv[flag + 1] : undefined;
  const structure: SeedTenant = code
    ? {
        code,
        legalName: 'Structure de test E2E',
        displayName: 'Structure de test E2E',
        type: 'hospital',
      }
    : DEMO_TENANT;
  seedDemo(url, password, structure)
    .then(() => {
      console.warn(`Structure de démonstration prête : code ${structure.code}.`);
      console.warn(
        `Comptes : ${DEMO_USERS.map((u) => u.username).join(', ')} (mot de passe MEDHUB_SEED_PASSWORD).`,
      );
    })
    .catch((error: unknown) => {
      console.error('Échec du seed :', error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
