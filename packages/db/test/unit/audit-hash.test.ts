import { describe, expect, it } from 'vitest';
import { AUDIT_GENESIS_HASH, auditHash } from '../../src/audit';

const row = {
  id: '01900000-0000-7000-8000-000000000001',
  tenantId: '01900000-0000-7000-8000-000000000002',
  seq: 1,
  at: new Date('2026-10-29T08:00:00.000Z'),
  userId: null,
  deviceId: null,
  ip: null,
  action: 'create',
  entity: 'patient',
  entityId: null,
  patientId: null,
  reason: null,
  diff: { b: 1, a: 2 },
  prevHash: AUDIT_GENESIS_HASH,
};

describe('audit hash', () => {
  it('is deterministic and independent of key order', () => {
    expect(auditHash(AUDIT_GENESIS_HASH, row)).toBe(
      auditHash(AUDIT_GENESIS_HASH, { ...row, diff: { a: 2, b: 1 } }),
    );
  });

  it('changes when any field changes', () => {
    expect(auditHash(AUDIT_GENESIS_HASH, row)).not.toBe(
      auditHash(AUDIT_GENESIS_HASH, { ...row, action: 'read' }),
    );
  });
});
