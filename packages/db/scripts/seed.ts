import { randomBytes } from 'node:crypto';
import { ROLE_TEMPLATES, uuidv7 } from '@medhub/shared';
import { and, eq } from 'drizzle-orm';
import { appendAudit } from '../src/audit';
import { createDb } from '../src/client';
import { withSystem, withTenant } from '../src/context';
import { hashPassword } from '../src/password';
import {
  department,
  role,
  rolePermission,
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
