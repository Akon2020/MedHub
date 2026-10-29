import { uuidv7 } from '@medhub/shared';
import type { Tx } from '../../src/client';
import { appendAudit } from '../../src/audit';
import {
  changeLog,
  dataAccessLog,
  device,
  numberSeries,
  opLog,
  patient,
  role,
  rolePermission,
  session,
  site,
  stockMovement,
  syncConflict,
  userAccount,
  userRole,
  vitalSign,
} from '../../src/schema';

/**
 * One factory per tenant table. The isolation suite fails if a table with a
 * tenant_id column has no factory here, so a new table cannot skip the test.
 */
export const FACTORIES: Record<string, (tx: Tx, tenantId: string) => Promise<void>> = {
  site: async (tx, tenantId) => {
    await tx.insert(site).values({ id: uuidv7(), tenantId, code: 'KIN', name: 'Site test' });
  },
  device: async (tx, tenantId) => {
    await tx.insert(device).values({
      id: uuidv7(),
      tenantId,
      userId: uuidv7(),
      deviceCode: 'AA',
      name: 'Poste test',
      kind: 'desktop',
      publicKey: 'test',
    });
  },
  role: async (tx, tenantId) => {
    await tx.insert(role).values({ id: uuidv7(), tenantId, code: 'nurse', name: 'Infirmier' });
  },
  role_permission: async (tx, tenantId) => {
    await tx
      .insert(rolePermission)
      .values({ tenantId, roleId: uuidv7(), permissionKey: 'patient:read' });
  },
  user_account: async (tx, tenantId) => {
    await tx.insert(userAccount).values({
      id: uuidv7(),
      tenantId,
      username: 'test',
      displayName: 'Utilisateur Test',
      passwordHash: 'x',
    });
  },
  user_role: async (tx, tenantId) => {
    await tx
      .insert(userRole)
      .values({ id: uuidv7(), tenantId, userId: uuidv7(), roleId: uuidv7() });
  },
  session: async (tx, tenantId) => {
    await tx.insert(session).values({
      id: uuidv7(),
      tenantId,
      userId: uuidv7(),
      tokenHash: uuidv7(),
      expiresAt: new Date(Date.now() + 3_600_000),
    });
  },
  audit_log: async (tx, tenantId) => {
    await appendAudit(tx, { tenantId, userId: null, action: 'create', entity: 'test' });
  },
  data_access_log: async (tx, tenantId) => {
    await tx.insert(dataAccessLog).values({
      id: uuidv7(),
      tenantId,
      userId: uuidv7(),
      patientId: uuidv7(),
      screen: 'summary',
    });
  },
  number_series: async (tx, tenantId) => {
    await tx.insert(numberSeries).values({
      id: uuidv7(),
      tenantId,
      docType: 'invoice',
      year: 2026,
      template: '{SITE}-{DEVICE}-{YYYY}-{SEQ:6}',
    });
  },
  op_log: async (tx, tenantId) => {
    await tx.insert(opLog).values({
      opId: uuidv7(),
      tenantId,
      deviceId: uuidv7(),
      userId: uuidv7(),
      command: 'patient.register',
      entity: 'patient',
      entityId: uuidv7(),
      payload: {},
      hlc: '000000000000001:000000:x',
      clientTs: new Date(),
      status: 'applied',
      result: {},
      schemaVersion: 1,
      signature: 'x',
    });
  },
  change_log: async (tx, tenantId) => {
    await tx
      .insert(changeLog)
      .values({ tenantId, entity: 'patient', entityId: uuidv7(), version: 1 });
  },
  sync_conflict: async (tx, tenantId) => {
    await tx.insert(syncConflict).values({
      id: uuidv7(),
      tenantId,
      entity: 'patient',
      entityId: uuidv7(),
      opId: uuidv7(),
      kind: 'sensitive_field',
    });
  },
  patient: async (tx, tenantId) => {
    await tx.insert(patient).values({
      id: uuidv7(),
      tenantId,
      mrn: `T-${uuidv7()}`,
      familyName: 'Fictif',
      sex: 'U',
      searchText: 'fictif',
      phoneticKey: 'fiktif',
    });
  },
  vital_sign: async (tx, tenantId) => {
    await tx.insert(vitalSign).values({
      id: uuidv7(),
      tenantId,
      patientId: uuidv7(),
      code: 'temp',
      value: 37.2,
      unit: '°C',
      measuredAt: new Date(),
    });
  },
  stock_movement: async (tx, tenantId) => {
    await tx.insert(stockMovement).values({
      id: uuidv7(),
      tenantId,
      warehouseId: uuidv7(),
      productId: uuidv7(),
      kind: 'receipt',
      quantity: 10,
    });
  },
};
