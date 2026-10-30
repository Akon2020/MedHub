import { describe, expect, it } from 'vitest';
import {
  grantChanges,
  isPrivilegedRole,
  roleCreateSchema,
  roleUpdateSchema,
  templateGrants,
} from './roles';

const ROLE = '0190f1a2-0000-7000-8000-000000000002';

describe('role editing rules', () => {
  it('accepts known permissions with an allowed scope only', () => {
    const base = { roleId: ROLE, name: 'Accueil du soir', requiresMfa: false };
    expect(
      roleUpdateSchema.safeParse({
        ...base,
        grants: [
          { key: 'patient:read', scope: 'site' },
          { key: 'stock:read', scope: 'warehouse' },
          { key: 'queue:call' },
        ],
      }).success,
    ).toBe(true);
    expect(
      roleUpdateSchema.safeParse({ ...base, grants: [{ key: 'patient:fly', scope: 'tenant' }] })
        .success,
    ).toBe(false);
    expect(
      roleUpdateSchema.safeParse({ ...base, grants: [{ key: 'patient:read', scope: 'warehouse' }] })
        .success,
    ).toBe(false);
    expect(
      roleUpdateSchema.safeParse({
        ...base,
        grants: [
          { key: 'patient:read', scope: 'tenant' },
          { key: 'patient:read', scope: 'site' },
        ],
      }).success,
    ).toBe(false);
  });

  it('normalizes role codes', () => {
    expect(roleCreateSchema.parse({ code: ' Accueil_Soir ', name: 'Accueil du soir' }).code).toBe(
      'accueil_soir',
    );
    expect(roleCreateSchema.safeParse({ code: 'accueil soir', name: 'Accueil' }).success).toBe(
      false,
    );
  });

  it('marks administrative roles as privileged', () => {
    expect(isPrivilegedRole(null, ['patient:read'])).toBe(false);
    expect(isPrivilegedRole(null, ['patient:read', 'user:create'])).toBe(true);
    expect(isPrivilegedRole('director', ['report:read'])).toBe(true);
  });

  it('lists added, removed and rescoped permissions, and template grants', () => {
    expect(
      grantChanges(
        [
          { key: 'patient:read', scope: 'tenant' },
          { key: 'queue:read', scope: 'tenant' },
        ],
        [
          { key: 'patient:read', scope: 'site' },
          { key: 'queue:call', scope: 'tenant' },
        ],
      ),
    ).toEqual({ added: ['queue:call'], removed: ['queue:read'], rescoped: ['patient:read'] });
    expect(templateGrants('cashier')?.some((g) => g.key === 'payment:receive')).toBe(true);
    expect(templateGrants('custom')).toBeNull();
  });
});
