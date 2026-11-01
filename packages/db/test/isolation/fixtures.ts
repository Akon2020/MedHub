import { uuidv7 } from '@medhub/shared';
import type { Tx } from '../../src/client';
import { appendAudit } from '../../src/audit';
import {
  allergy,
  appointment,
  clinicalEvent,
  appointmentType,
  breakGlassEvent,
  changeLog,
  choiceItem,
  choiceList,
  configEntry,
  dataAccessLog,
  department,
  device,
  devicePatient,
  encounter,
  medicalHistory,
  duplicateCandidate,
  mfaRecoveryCode,
  numberSeries,
  opLog,
  patient,
  patientFavorite,
  patientFieldHistory,
  patientMerge,
  problem,
  queue,
  queueTicket,
  role,
  rolePermission,
  scheduleException,
  scheduleTemplate,
  session,
  site,
  stockMovement,
  syncConflict,
  syncScopeRule,
  triage,
  userAccount,
  userRole,
  vitalSign,
  vitalSignDefinition,
} from '../../src/schema';

/**
 * One factory per tenant table. The isolation suite fails if a table with a
 * tenant_id column has no factory here, so a new table cannot skip the test.
 */
export const FACTORIES: Record<string, (tx: Tx, tenantId: string) => Promise<void>> = {
  site: async (tx, tenantId) => {
    await tx.insert(site).values({ id: uuidv7(), tenantId, code: 'KIN', name: 'Site test' });
  },
  config_entry: async (tx, tenantId) => {
    await tx.insert(configEntry).values({
      id: uuidv7(),
      tenantId,
      domain: 'security',
      key: 'security.auto_lock_minutes',
      version: 1,
      value: 5,
    });
  },
  choice_list: async (tx, tenantId) => {
    await tx
      .insert(choiceList)
      .values({ id: uuidv7(), tenantId, code: 'ARRIVEE', nameFr: "Mode d'arrivée" });
  },
  choice_item: async (tx, tenantId) => {
    await tx.insert(choiceItem).values({
      id: uuidv7(),
      tenantId,
      listId: uuidv7(),
      code: 'PIED',
      labelFr: 'À pied',
    });
  },
  department: async (tx, tenantId) => {
    await tx.insert(department).values({
      id: uuidv7(),
      tenantId,
      siteId: uuidv7(),
      code: 'CONS',
      name: 'Consultations',
      kind: 'clinical',
    });
  },
  duplicate_candidate: async (tx, tenantId) => {
    await tx.insert(duplicateCandidate).values({
      id: uuidv7(),
      tenantId,
      patientAId: '00000000-0000-7000-8000-000000000001',
      patientBId: '00000000-0000-7000-8000-000000000002',
      score: 95,
    });
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
  device_patient: async (tx, tenantId) => {
    await tx.insert(devicePatient).values({
      id: uuidv7(),
      tenantId,
      deviceId: uuidv7(),
      patientId: uuidv7(),
    });
  },
  patient_favorite: async (tx, tenantId) => {
    await tx.insert(patientFavorite).values({
      id: uuidv7(),
      tenantId,
      patientId: uuidv7(),
      userId: uuidv7(),
      active: true,
      at: new Date(),
    });
  },
  sync_scope_rule: async (tx, tenantId) => {
    await tx.insert(syncScopeRule).values({
      id: uuidv7(),
      tenantId,
      entity: 'patient',
      rule: { mode: 'scoped', recentDays: 30 },
    });
  },
  encounter: async (tx, tenantId) => {
    await tx.insert(encounter).values({
      id: uuidv7(),
      tenantId,
      patientId: uuidv7(),
      kind: 'outpatient',
      status: 'arrived',
      visitNumber: `KIN-AA-2026-${String(Math.floor(Math.random() * 1e6)).padStart(6, '0')}`,
      startedAt: new Date(),
    });
  },
  queue_ticket: async (tx, tenantId) => {
    await tx.insert(queueTicket).values({
      id: uuidv7(),
      tenantId,
      queueId: uuidv7(),
      patientId: uuidv7(),
      number: 'C-AA-001',
      priority: 'normal',
      status: 'waiting',
      issuedAt: new Date(),
    });
  },
  triage: async (tx, tenantId) => {
    await tx.insert(triage).values({
      id: uuidv7(),
      tenantId,
      encounterId: uuidv7(),
      patientId: uuidv7(),
      priority: 'normal',
      chiefComplaint: 'Fièvre',
      triagedAt: new Date(),
    });
  },
  appointment: async (tx, tenantId) => {
    await tx.insert(appointment).values({
      id: uuidv7(),
      tenantId,
      patientId: uuidv7(),
      resourceKind: 'practitioner',
      resourceId: uuidv7(),
      startsAt: new Date('2026-12-01T08:00:00Z'),
      endsAt: new Date('2026-12-01T08:15:00Z'),
      status: 'booked',
    });
  },
  allergy: async (tx, tenantId) => {
    await tx.insert(allergy).values({
      id: uuidv7(),
      tenantId,
      patientId: uuidv7(),
      notedAt: new Date(),
      substance: 'Amoxicilline',
      severity: 'severe',
    });
  },
  medical_history: async (tx, tenantId) => {
    await tx.insert(medicalHistory).values({
      id: uuidv7(),
      tenantId,
      patientId: uuidv7(),
      notedAt: new Date(),
      category: 'surgical',
      label: 'Appendicectomie',
    });
  },
  problem: async (tx, tenantId) => {
    await tx.insert(problem).values({
      id: uuidv7(),
      tenantId,
      patientId: uuidv7(),
      notedAt: new Date(),
      label: 'Hypertension',
    });
  },
  clinical_event: async (tx, tenantId) => {
    await tx.insert(clinicalEvent).values({
      id: uuidv7(),
      tenantId,
      patientId: uuidv7(),
      kind: 'problem',
      refTable: 'problem',
      refId: uuidv7(),
      occurredAt: new Date(),
    });
  },
  vital_sign_definition: async (tx, tenantId) => {
    await tx.insert(vitalSignDefinition).values({
      id: uuidv7(),
      tenantId,
      code: 'pulse',
      plausibleMin: 20,
      plausibleMax: 250,
    });
  },
  break_glass_event: async (tx, tenantId) => {
    await tx.insert(breakGlassEvent).values({
      id: uuidv7(),
      tenantId,
      userId: uuidv7(),
      patientId: uuidv7(),
      reasonCode: 'life_threatening',
      reasonText: 'Urgence vitale',
      startedAt: new Date(),
      endsAt: new Date(Date.now() + 3_600_000),
    });
  },
  queue: async (tx, tenantId) => {
    await tx.insert(queue).values({
      id: uuidv7(),
      tenantId,
      siteId: uuidv7(),
      code: 'CONS',
      name: 'Consultations',
      ticketPrefix: 'C',
    });
  },
  appointment_type: async (tx, tenantId) => {
    await tx.insert(appointmentType).values({
      id: uuidv7(),
      tenantId,
      code: 'CONS',
      name: 'Consultation',
      durationMin: 15,
    });
  },
  schedule_template: async (tx, tenantId) => {
    await tx.insert(scheduleTemplate).values({
      id: uuidv7(),
      tenantId,
      resourceKind: 'practitioner',
      resourceId: uuidv7(),
      weekday: 1,
      startTime: '08:00',
      endTime: '12:00',
      slotMin: 15,
    });
  },
  schedule_exception: async (tx, tenantId) => {
    await tx.insert(scheduleException).values({
      id: uuidv7(),
      tenantId,
      resourceKind: 'practitioner',
      resourceId: uuidv7(),
      date: '2026-12-25',
      kind: 'closed',
    });
  },
  patient_field_history: async (tx, tenantId) => {
    await tx.insert(patientFieldHistory).values({
      id: uuidv7(),
      tenantId,
      patientId: uuidv7(),
      field: 'phone',
      oldValue: null,
      newValue: '0991234567',
      source: 'sync',
    });
  },
  patient_merge: async (tx, tenantId) => {
    await tx.insert(patientMerge).values({
      id: uuidv7(),
      tenantId,
      survivorId: uuidv7(),
      mergedId: uuidv7(),
      survivorBefore: {},
      mergedBefore: {},
      reason: 'Doublon de test',
      mergedBy: uuidv7(),
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
  mfa_recovery_code: async (tx, tenantId) => {
    await tx
      .insert(mfaRecoveryCode)
      .values({ id: uuidv7(), tenantId, userId: uuidv7(), codeHash: uuidv7() });
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
