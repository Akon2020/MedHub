import 'server-only';
import {
  appendAudit,
  enqueue,
  recordSecurityEvent,
  schema,
  withTenant,
  type Db,
  type Tx,
} from '@medhub/db';
import {
  ENTITIES,
  SLOT_HOLDING_STATUSES,
  getCommand,
  slotCapacity,
  type EntityName,
  type PatientRegisterPayload,
} from '@medhub/domain';
import { evaluateForm, formDefinition } from '@medhub/forms';
import type { StockMovementKind } from '@medhub/shared';
import { formatHlc, uuidv7 } from '@medhub/shared';
import {
  createState,
  deriveData,
  type EntityState,
  type OpResult,
  type Operation,
} from '@medhub/sync';
import {
  DuplicateOperationError,
  type ChangeEntry,
  type ChangeRow,
  type ConflictEntry,
  type ServerPullStore,
  type ServerSyncStore,
  type ServerSyncTx,
} from '@medhub/sync/server';
import { and, asc, eq, gt, gte, inArray, isNull, lte, ne } from 'drizzle-orm';

type Ctx = { tenantId: string; userId: string; deviceId: string | null };

function compact(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) if (v !== null && v !== undefined) out[k] = v;
  return out;
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const instant = (v: unknown): Date | null => (typeof v === 'string' && v ? new Date(v) : null);
const record = (v: unknown): Record<string, string | null> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, string | null>) : null;

/** Civil status fields traced one by one in patient_field_history. */
const TRACKED_FIELDS = [
  'familyName',
  'middleName',
  'givenName',
  'sex',
  'birthDate',
  'birthDateEstimated',
  'phone',
  'sensitivity',
  'address',
  'occupation',
  'maritalStatus',
  'nationality',
  'language',
  'fatherName',
  'motherName',
  'contact',
  'cardToken',
  'isProvisional',
  'deceasedAt',
  'mergedIntoId',
] as const;

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** One history row per field whose value really changed. */
async function recordFieldHistory(
  tx: Tx,
  input: {
    tenantId: string;
    patientId: string;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
    source: 'sync' | 'merge' | 'unmerge' | 'review';
    opId: string | null;
    hlc: string | null;
    deviceId: string | null;
    changedBy: string | null;
  },
): Promise<void> {
  const rows = TRACKED_FIELDS.filter((f) => !same(input.before[f], input.after[f])).map(
    (field) => ({
      id: uuidv7(),
      tenantId: input.tenantId,
      patientId: input.patientId,
      field,
      oldValue: input.before[field] ?? null,
      newValue: input.after[field] ?? null,
      source: input.source,
      opId: input.opId,
      hlc: input.hlc,
      deviceId: input.deviceId,
      changedBy: input.changedBy,
    }),
  );
  if (rows.length > 0) await tx.insert(schema.patientFieldHistory).values(rows);
}

/** Mapping between the domain entity state and the PostgreSQL rows, one per entity. */
const mappers = {
  patient: {
    table: schema.patient,
    toState(row: typeof schema.patient.$inferSelect): EntityState {
      return {
        id: row.id,
        version: row.version,
        data: compact({
          mrn: row.mrn,
          familyName: row.familyName,
          middleName: row.middleName,
          givenName: row.givenName,
          sex: row.sex,
          birthDate: row.birthDate,
          birthDateEstimated: row.birthDateEstimated,
          phone: row.phone,
          sensitivity: row.sensitivity,
          searchText: row.searchText,
          phoneticKey: row.phoneticKey,
          mergedIntoId: row.mergedIntoId,
          address: row.address,
          occupation: row.occupation,
          maritalStatus: row.maritalStatus,
          nationality: row.nationality,
          language: row.language,
          fatherName: row.fatherName,
          motherName: row.motherName,
          contact: row.contact,
          cardToken: row.cardToken,
          isProvisional: row.isProvisional,
          provisionalKind: row.provisionalKind,
          deceasedAt: row.deceasedAt?.toISOString(),
        }),
        fieldMeta: row.fieldMeta,
        hlc: row.hlc ?? '',
        opId: row.opId ?? '',
        deviceId: row.deviceId ?? '',
        createdBy: row.createdBy ?? '',
      };
    },
    toRow(state: EntityState, ctx: Ctx): typeof schema.patient.$inferInsert {
      const d = state.data;
      return {
        id: state.id,
        tenantId: ctx.tenantId,
        version: state.version,
        mrn: String(d.mrn),
        familyName: String(d.familyName),
        middleName: str(d.middleName),
        givenName: str(d.givenName),
        sex: String(d.sex),
        birthDate: str(d.birthDate),
        birthDateEstimated: d.birthDateEstimated === true,
        phone: str(d.phone),
        sensitivity: str(d.sensitivity) ?? 'normal',
        searchText: String(d.searchText ?? ''),
        phoneticKey: String(d.phoneticKey ?? ''),
        mergedIntoId: str(d.mergedIntoId),
        address: record(d.address),
        occupation: str(d.occupation),
        maritalStatus: str(d.maritalStatus),
        nationality: str(d.nationality),
        language: str(d.language),
        fatherName: str(d.fatherName),
        motherName: str(d.motherName),
        contact: record(d.contact),
        cardToken: str(d.cardToken),
        isProvisional: d.isProvisional === true,
        provisionalKind: str(d.provisionalKind),
        deceasedAt: str(d.deceasedAt) ? new Date(String(d.deceasedAt)) : null,
        fieldMeta: state.fieldMeta,
        hlc: state.hlc,
        opId: state.opId || null,
        deviceId: state.deviceId || null,
        createdBy: state.createdBy || null,
        updatedAt: new Date(),
        updatedBy: ctx.userId,
      };
    },
  },
  vital_sign: {
    table: schema.vitalSign,
    toState(row: typeof schema.vitalSign.$inferSelect): EntityState {
      return {
        id: row.id,
        version: row.version,
        data: compact({
          patientId: row.patientId,
          encounterId: row.encounterId,
          code: row.code,
          value: row.value,
          unit: row.unit,
          measuredAt: row.measuredAt.toISOString(),
          supersedesId: row.supersedesId,
          plausibilityOverrideReason: row.plausibilityOverrideReason,
          status: row.status,
        }),
        fieldMeta: {},
        hlc: row.hlc ?? '',
        opId: row.opId ?? '',
        deviceId: row.deviceId ?? '',
        createdBy: row.createdBy ?? '',
      };
    },
    toRow(state: EntityState, ctx: Ctx): typeof schema.vitalSign.$inferInsert {
      const d = state.data;
      return {
        id: state.id,
        tenantId: ctx.tenantId,
        version: state.version,
        patientId: String(d.patientId),
        encounterId: str(d.encounterId),
        code: String(d.code),
        value: Number(d.value),
        unit: String(d.unit),
        measuredAt: new Date(String(d.measuredAt)),
        measuredBy: state.createdBy || null,
        supersedesId: str(d.supersedesId),
        plausibilityOverrideReason: str(d.plausibilityOverrideReason),
        status: str(d.status) ?? 'active',
        hlc: state.hlc,
        opId: state.opId || null,
        deviceId: state.deviceId || null,
        createdBy: state.createdBy || null,
      };
    },
  },
  encounter: {
    table: schema.encounter,
    toState(row: typeof schema.encounter.$inferSelect): EntityState {
      return {
        id: row.id,
        version: row.version,
        data: compact({
          patientId: row.patientId,
          kind: row.kind,
          status: row.status,
          departmentId: row.departmentId,
          practitionerId: row.practitionerId,
          appointmentId: row.appointmentId,
          visitNumber: row.visitNumber,
          startedAt: row.startedAt.toISOString(),
          endedAt: row.endedAt?.toISOString(),
        }),
        fieldMeta: row.fieldMeta,
        hlc: row.hlc ?? '',
        opId: row.opId ?? '',
        deviceId: row.deviceId ?? '',
        createdBy: row.createdBy ?? '',
      };
    },
    toRow(state: EntityState, ctx: Ctx): typeof schema.encounter.$inferInsert {
      const d = state.data;
      return {
        id: state.id,
        tenantId: ctx.tenantId,
        version: state.version,
        patientId: String(d.patientId),
        kind: String(d.kind),
        status: String(d.status),
        departmentId: str(d.departmentId),
        practitionerId: str(d.practitionerId),
        appointmentId: str(d.appointmentId),
        visitNumber: String(d.visitNumber),
        startedAt: new Date(String(d.startedAt)),
        endedAt: instant(d.endedAt),
        fieldMeta: state.fieldMeta,
        hlc: state.hlc,
        opId: state.opId || null,
        deviceId: state.deviceId || null,
        createdBy: state.createdBy || null,
        updatedAt: new Date(),
        updatedBy: ctx.userId,
      };
    },
  },
  queue_ticket: {
    table: schema.queueTicket,
    toState(row: typeof schema.queueTicket.$inferSelect): EntityState {
      return {
        id: row.id,
        version: row.version,
        data: compact({
          queueId: row.queueId,
          patientId: row.patientId,
          encounterId: row.encounterId,
          number: row.number,
          priority: row.priority,
          status: row.status,
          issuedAt: row.issuedAt.toISOString(),
          calledAt: row.calledAt?.toISOString(),
          room: row.room,
          serviceStartedAt: row.serviceStartedAt?.toISOString(),
          completedAt: row.completedAt?.toISOString(),
          leftAt: row.leftAt?.toISOString(),
        }),
        fieldMeta: row.fieldMeta,
        hlc: row.hlc ?? '',
        opId: row.opId ?? '',
        deviceId: row.deviceId ?? '',
        createdBy: row.createdBy ?? '',
      };
    },
    toRow(state: EntityState, ctx: Ctx): typeof schema.queueTicket.$inferInsert {
      const d = state.data;
      return {
        id: state.id,
        tenantId: ctx.tenantId,
        version: state.version,
        queueId: String(d.queueId),
        patientId: String(d.patientId),
        encounterId: str(d.encounterId),
        number: String(d.number),
        priority: String(d.priority),
        status: String(d.status),
        issuedAt: new Date(String(d.issuedAt)),
        calledAt: instant(d.calledAt),
        room: str(d.room),
        serviceStartedAt: instant(d.serviceStartedAt),
        completedAt: instant(d.completedAt),
        leftAt: instant(d.leftAt),
        fieldMeta: state.fieldMeta,
        hlc: state.hlc,
        opId: state.opId || null,
        deviceId: state.deviceId || null,
        createdBy: state.createdBy || null,
        updatedAt: new Date(),
        updatedBy: ctx.userId,
      };
    },
  },
  triage: {
    table: schema.triage,
    toState(row: typeof schema.triage.$inferSelect): EntityState {
      return {
        id: row.id,
        version: row.version,
        data: compact({
          encounterId: row.encounterId,
          patientId: row.patientId,
          priority: row.priority,
          chiefComplaint: row.chiefComplaint,
          notes: row.notes,
          orientationQueueId: row.orientationQueueId,
          triagedAt: row.triagedAt.toISOString(),
          supersedesId: row.supersedesId,
          status: row.status,
        }),
        fieldMeta: {},
        hlc: row.hlc ?? '',
        opId: row.opId ?? '',
        deviceId: row.deviceId ?? '',
        createdBy: row.createdBy ?? '',
      };
    },
    toRow(state: EntityState, ctx: Ctx): typeof schema.triage.$inferInsert {
      const d = state.data;
      return {
        id: state.id,
        tenantId: ctx.tenantId,
        version: state.version,
        encounterId: String(d.encounterId),
        patientId: String(d.patientId),
        priority: String(d.priority),
        chiefComplaint: String(d.chiefComplaint),
        notes: str(d.notes),
        orientationQueueId: str(d.orientationQueueId),
        triagedAt: new Date(String(d.triagedAt)),
        triagedBy: state.createdBy || null,
        supersedesId: str(d.supersedesId),
        status: str(d.status) ?? 'active',
        hlc: state.hlc,
        opId: state.opId || null,
        deviceId: state.deviceId || null,
        createdBy: state.createdBy || null,
      };
    },
  },
  appointment: {
    table: schema.appointment,
    toState(row: typeof schema.appointment.$inferSelect): EntityState {
      return {
        id: row.id,
        version: row.version,
        data: compact({
          patientId: row.patientId,
          resourceKind: row.resourceKind,
          resourceId: row.resourceId,
          appointmentTypeId: row.appointmentTypeId,
          startsAt: row.startsAt.toISOString(),
          endsAt: row.endsAt.toISOString(),
          status: row.status,
          cancelReason: row.cancelReason,
          source: row.source,
          notes: row.notes,
        }),
        fieldMeta: row.fieldMeta,
        hlc: row.hlc ?? '',
        opId: row.opId ?? '',
        deviceId: row.deviceId ?? '',
        createdBy: row.createdBy ?? '',
      };
    },
    toRow(state: EntityState, ctx: Ctx): typeof schema.appointment.$inferInsert {
      const d = state.data;
      return {
        id: state.id,
        tenantId: ctx.tenantId,
        version: state.version,
        patientId: String(d.patientId),
        resourceKind: String(d.resourceKind),
        resourceId: String(d.resourceId),
        appointmentTypeId: str(d.appointmentTypeId),
        startsAt: new Date(String(d.startsAt)),
        endsAt: new Date(String(d.endsAt)),
        status: String(d.status),
        cancelReason: str(d.cancelReason),
        source: str(d.source) ?? 'front_desk',
        notes: str(d.notes),
        fieldMeta: state.fieldMeta,
        hlc: state.hlc,
        opId: state.opId || null,
        deviceId: state.deviceId || null,
        createdBy: state.createdBy || null,
        updatedAt: new Date(),
        updatedBy: ctx.userId,
      };
    },
  },
  allergy: {
    table: schema.allergy,
    toState(row: typeof schema.allergy.$inferSelect): EntityState {
      return {
        id: row.id,
        version: row.version,
        data: compact({
          patientId: row.patientId,
          notedAt: row.notedAt.toISOString(),
          status: row.status,
          retractReason: row.retractReason,
          retractedAt: row.retractedAt?.toISOString(),
          substance: row.substance,
          atcCode: row.atcCode,
          category: row.category,
          reaction: row.reaction,
          severity: row.severity,
          certainty: row.certainty,
          noneKnown: row.noneKnown,
        }),
        fieldMeta: row.fieldMeta,
        hlc: row.hlc ?? '',
        opId: row.opId ?? '',
        deviceId: row.deviceId ?? '',
        createdBy: row.createdBy ?? '',
      };
    },
    toRow(state: EntityState, ctx: Ctx): typeof schema.allergy.$inferInsert {
      const d = state.data;
      return {
        id: state.id,
        tenantId: ctx.tenantId,
        version: state.version,
        patientId: String(d.patientId),
        notedAt: new Date(String(d.notedAt)),
        status: str(d.status) ?? 'active',
        retractReason: str(d.retractReason),
        retractedAt: instant(d.retractedAt),
        substance: str(d.substance),
        atcCode: str(d.atcCode),
        category: str(d.category),
        reaction: str(d.reaction),
        severity: str(d.severity),
        certainty: str(d.certainty),
        noneKnown: d.noneKnown === true,
        fieldMeta: state.fieldMeta,
        hlc: state.hlc,
        opId: state.opId || null,
        deviceId: state.deviceId || null,
        createdBy: state.createdBy || null,
        updatedAt: new Date(),
        updatedBy: ctx.userId,
      };
    },
  },
  medical_history: {
    table: schema.medicalHistory,
    toState(row: typeof schema.medicalHistory.$inferSelect): EntityState {
      return {
        id: row.id,
        version: row.version,
        data: compact({
          patientId: row.patientId,
          notedAt: row.notedAt.toISOString(),
          status: row.status,
          retractReason: row.retractReason,
          retractedAt: row.retractedAt?.toISOString(),
          category: row.category,
          label: row.label,
          icd10: row.icd10,
          startDate: row.startDate,
          endDate: row.endDate,
          source: row.source,
        }),
        fieldMeta: row.fieldMeta,
        hlc: row.hlc ?? '',
        opId: row.opId ?? '',
        deviceId: row.deviceId ?? '',
        createdBy: row.createdBy ?? '',
      };
    },
    toRow(state: EntityState, ctx: Ctx): typeof schema.medicalHistory.$inferInsert {
      const d = state.data;
      return {
        id: state.id,
        tenantId: ctx.tenantId,
        version: state.version,
        patientId: String(d.patientId),
        notedAt: new Date(String(d.notedAt)),
        status: str(d.status) ?? 'active',
        retractReason: str(d.retractReason),
        retractedAt: instant(d.retractedAt),
        category: String(d.category),
        label: String(d.label),
        icd10: str(d.icd10),
        startDate: str(d.startDate),
        endDate: str(d.endDate),
        source: str(d.source) ?? 'patient',
        fieldMeta: state.fieldMeta,
        hlc: state.hlc,
        opId: state.opId || null,
        deviceId: state.deviceId || null,
        createdBy: state.createdBy || null,
        updatedAt: new Date(),
        updatedBy: ctx.userId,
      };
    },
  },
  problem: {
    table: schema.problem,
    toState(row: typeof schema.problem.$inferSelect): EntityState {
      return {
        id: row.id,
        version: row.version,
        data: compact({
          patientId: row.patientId,
          notedAt: row.notedAt.toISOString(),
          status: row.status,
          retractReason: row.retractReason,
          retractedAt: row.retractedAt?.toISOString(),
          label: row.label,
          icd10: row.icd10,
          onsetDate: row.onsetDate,
          resolvedDate: row.resolvedDate,
          sourceEncounterId: row.sourceEncounterId,
        }),
        fieldMeta: row.fieldMeta,
        hlc: row.hlc ?? '',
        opId: row.opId ?? '',
        deviceId: row.deviceId ?? '',
        createdBy: row.createdBy ?? '',
      };
    },
    toRow(state: EntityState, ctx: Ctx): typeof schema.problem.$inferInsert {
      const d = state.data;
      return {
        id: state.id,
        tenantId: ctx.tenantId,
        version: state.version,
        patientId: String(d.patientId),
        notedAt: new Date(String(d.notedAt)),
        status: str(d.status) ?? 'active',
        retractReason: str(d.retractReason),
        retractedAt: instant(d.retractedAt),
        label: String(d.label),
        icd10: str(d.icd10),
        onsetDate: str(d.onsetDate),
        resolvedDate: str(d.resolvedDate),
        sourceEncounterId: str(d.sourceEncounterId),
        fieldMeta: state.fieldMeta,
        hlc: state.hlc,
        opId: state.opId || null,
        deviceId: state.deviceId || null,
        createdBy: state.createdBy || null,
        updatedAt: new Date(),
        updatedBy: ctx.userId,
      };
    },
  },
  clinical_note: {
    table: schema.clinicalNote,
    toState(row: typeof schema.clinicalNote.$inferSelect): EntityState {
      return {
        id: row.id,
        version: row.version,
        data: compact({
          patientId: row.patientId,
          encounterId: row.encounterId,
          kind: row.kind,
          sections: row.sections,
          signedBy: row.signedBy,
          signedAt: row.signedAt.toISOString(),
          supersedesId: row.supersedesId,
          correctionReason: row.correctionReason,
          status: row.status,
        }),
        fieldMeta: {},
        hlc: row.hlc ?? '',
        opId: row.opId ?? '',
        deviceId: row.deviceId ?? '',
        createdBy: row.createdBy ?? '',
      };
    },
    toRow(state: EntityState, ctx: Ctx): typeof schema.clinicalNote.$inferInsert {
      const d = state.data;
      return {
        id: state.id,
        tenantId: ctx.tenantId,
        version: state.version,
        patientId: String(d.patientId),
        encounterId: str(d.encounterId),
        kind: String(d.kind),
        sections: (record(d.sections) ?? {}) as Record<string, string | null>,
        // The signer is the author of the device-signed operation.
        signedBy: state.createdBy || null,
        signedAt: new Date(String(d.signedAt)),
        signedOpId: state.opId || null,
        correctionReason: str(d.correctionReason),
        supersedesId: str(d.supersedesId),
        status: str(d.status) ?? 'active',
        hlc: state.hlc,
        opId: state.opId || null,
        deviceId: state.deviceId || null,
        createdBy: state.createdBy || null,
      };
    },
  },
  diagnosis: {
    table: schema.diagnosis,
    toState(row: typeof schema.diagnosis.$inferSelect): EntityState {
      return {
        id: row.id,
        version: row.version,
        data: compact({
          patientId: row.patientId,
          encounterId: row.encounterId,
          codeSystem: row.codeSystem,
          code: row.code,
          label: row.label,
          certainty: row.certainty,
          isPrimary: row.isPrimary,
          diagnosedAt: row.diagnosedAt.toISOString(),
          supersedesId: row.supersedesId,
          status: row.status,
        }),
        fieldMeta: {},
        hlc: row.hlc ?? '',
        opId: row.opId ?? '',
        deviceId: row.deviceId ?? '',
        createdBy: row.createdBy ?? '',
      };
    },
    toRow(state: EntityState, ctx: Ctx): typeof schema.diagnosis.$inferInsert {
      const d = state.data;
      return {
        id: state.id,
        tenantId: ctx.tenantId,
        version: state.version,
        patientId: String(d.patientId),
        encounterId: str(d.encounterId),
        codeSystem: String(d.codeSystem),
        code: str(d.code),
        label: String(d.label),
        certainty: String(d.certainty),
        isPrimary: d.isPrimary === true,
        diagnosedAt: new Date(String(d.diagnosedAt)),
        supersedesId: str(d.supersedesId),
        status: str(d.status) ?? 'active',
        hlc: state.hlc,
        opId: state.opId || null,
        deviceId: state.deviceId || null,
        createdBy: state.createdBy || null,
      };
    },
  },
  form_response: {
    table: schema.formResponse,
    toState(row: typeof schema.formResponse.$inferSelect): EntityState {
      return {
        id: row.id,
        version: row.version,
        data: compact({
          patientId: row.patientId,
          encounterId: row.encounterId,
          formVersionId: row.formVersionId,
          formCode: row.formCode,
          data: row.data,
          state: row.state,
          completedAt: row.completedAt.toISOString(),
          signedBy: row.signedBy,
          supersedesId: row.supersedesId,
          correctionReason: row.correctionReason,
          status: row.status,
        }),
        fieldMeta: {},
        hlc: row.hlc ?? '',
        opId: row.opId ?? '',
        deviceId: row.deviceId ?? '',
        createdBy: row.createdBy ?? '',
      };
    },
    toRow(state: EntityState, ctx: Ctx): typeof schema.formResponse.$inferInsert {
      const d = state.data;
      return {
        id: state.id,
        tenantId: ctx.tenantId,
        version: state.version,
        patientId: String(d.patientId),
        encounterId: str(d.encounterId),
        formVersionId: String(d.formVersionId),
        formCode: String(d.formCode),
        data: record(d.data) ?? {},
        state: String(d.state),
        completedAt: new Date(String(d.completedAt)),
        signedBy: d.state === 'signed' ? state.createdBy || null : null,
        correctionReason: str(d.correctionReason),
        supersedesId: str(d.supersedesId),
        status: str(d.status) ?? 'active',
        hlc: state.hlc,
        opId: state.opId || null,
        deviceId: state.deviceId || null,
        createdBy: state.createdBy || null,
      };
    },
  },
  program_enrollment: {
    table: schema.programEnrollment,
    toState(row: typeof schema.programEnrollment.$inferSelect): EntityState {
      return {
        id: row.id,
        version: row.version,
        data: compact({
          patientId: row.patientId,
          programId: row.programId,
          enrolledAt: row.enrolledAt.toISOString(),
          status: row.status,
          dischargedAt: row.dischargedAt?.toISOString(),
          dischargeReason: row.dischargeReason,
        }),
        fieldMeta: row.fieldMeta,
        hlc: row.hlc ?? '',
        opId: row.opId ?? '',
        deviceId: row.deviceId ?? '',
        createdBy: row.createdBy ?? '',
      };
    },
    toRow(state: EntityState, ctx: Ctx): typeof schema.programEnrollment.$inferInsert {
      const d = state.data;
      return {
        id: state.id,
        tenantId: ctx.tenantId,
        version: state.version,
        patientId: String(d.patientId),
        programId: String(d.programId),
        enrolledAt: new Date(String(d.enrolledAt)),
        status: str(d.status) ?? 'active',
        dischargedAt: instant(d.dischargedAt),
        dischargeReason: str(d.dischargeReason),
        fieldMeta: state.fieldMeta,
        hlc: state.hlc,
        opId: state.opId || null,
        deviceId: state.deviceId || null,
        createdBy: state.createdBy || null,
        updatedAt: new Date(),
        updatedBy: ctx.userId,
      };
    },
  },
  break_glass: {
    table: schema.breakGlassEvent,
    toState(row: typeof schema.breakGlassEvent.$inferSelect): EntityState {
      return {
        id: row.id,
        version: row.version,
        data: compact({
          patientId: row.patientId,
          userId: row.userId,
          reasonCode: row.reasonCode,
          reasonText: row.reasonText,
          startedAt: row.startedAt.toISOString(),
          endsAt: row.endsAt.toISOString(),
          status: row.status,
        }),
        fieldMeta: {},
        hlc: row.hlc ?? '',
        opId: row.opId ?? '',
        deviceId: row.deviceId ?? '',
        createdBy: row.createdBy ?? '',
      };
    },
    toRow(state: EntityState, ctx: Ctx): typeof schema.breakGlassEvent.$inferInsert {
      const d = state.data;
      return {
        id: state.id,
        tenantId: ctx.tenantId,
        version: state.version,
        // The user who breaks the glass is the author of the operation.
        userId: state.createdBy,
        patientId: String(d.patientId),
        reasonCode: String(d.reasonCode),
        reasonText: String(d.reasonText),
        startedAt: new Date(String(d.startedAt)),
        endsAt: new Date(String(d.endsAt)),
        status: str(d.status) ?? 'active',
        hlc: state.hlc,
        opId: state.opId || null,
        deviceId: state.deviceId || null,
        createdBy: state.createdBy || null,
      };
    },
  },
  record_access: {
    table: schema.dataAccessLog,
    toState(row: typeof schema.dataAccessLog.$inferSelect): EntityState {
      return {
        id: row.id,
        version: 1,
        data: compact({
          patientId: row.patientId,
          screen: row.screen,
          at: row.at.toISOString(),
          reason: row.reason,
        }),
        fieldMeta: {},
        hlc: '',
        opId: '',
        deviceId: row.deviceId ?? '',
        createdBy: row.userId,
      };
    },
    toRow(state: EntityState, ctx: Ctx): typeof schema.dataAccessLog.$inferInsert {
      const d = state.data;
      return {
        id: state.id,
        tenantId: ctx.tenantId,
        at: new Date(String(d.at)),
        // The reader is the author of the operation, never a value of the payload.
        userId: state.createdBy,
        deviceId: state.deviceId || null,
        patientId: String(d.patientId),
        screen: String(d.screen),
        reason: str(d.reason),
      };
    },
  },
  patient_favorite: {
    table: schema.patientFavorite,
    toState(row: typeof schema.patientFavorite.$inferSelect): EntityState {
      return {
        id: row.id,
        version: row.version,
        data: {
          patientId: row.patientId,
          userId: row.userId,
          active: row.active,
          at: row.at.toISOString(),
          status: row.status,
        },
        fieldMeta: {},
        hlc: row.hlc ?? '',
        opId: row.opId ?? '',
        deviceId: row.deviceId ?? '',
        createdBy: row.createdBy ?? '',
      };
    },
    toRow(state: EntityState, ctx: Ctx): typeof schema.patientFavorite.$inferInsert {
      const d = state.data;
      return {
        id: state.id,
        tenantId: ctx.tenantId,
        version: state.version,
        patientId: String(d.patientId),
        // The owner is the author of the operation, never a value from the payload.
        userId: state.createdBy,
        active: d.active === true,
        at: new Date(String(d.at)),
        hlc: state.hlc,
        opId: state.opId || null,
        deviceId: state.deviceId || null,
        createdBy: state.createdBy || null,
      };
    },
  },
  stock_movement: {
    table: schema.stockMovement,
    toState(row: typeof schema.stockMovement.$inferSelect): EntityState {
      return {
        id: row.id,
        version: row.version,
        data: compact({
          warehouseId: row.warehouseId,
          productId: row.productId,
          lotId: row.lotId,
          kind: row.kind,
          quantity: row.quantity,
          reason: row.reason,
          status: row.status,
        }),
        fieldMeta: {},
        hlc: row.hlc ?? '',
        opId: row.opId ?? '',
        deviceId: row.deviceId ?? '',
        createdBy: row.createdBy ?? '',
      };
    },
    toRow(state: EntityState, ctx: Ctx): typeof schema.stockMovement.$inferInsert {
      const d = state.data;
      return {
        id: state.id,
        tenantId: ctx.tenantId,
        version: state.version,
        warehouseId: String(d.warehouseId),
        productId: String(d.productId),
        lotId: str(d.lotId),
        kind: String(d.kind),
        quantity: Number(d.quantity),
        reason: str(d.reason),
        status: str(d.status) ?? 'active',
        hlc: state.hlc,
        opId: state.opId || null,
        deviceId: state.deviceId || null,
        createdBy: state.createdBy || null,
      };
    },
  },
} as const;

/** Kind and instant of each clinical fact in the single timeline of the record. */
const TIMELINE: Partial<Record<EntityName, { kind: string; table: string; at: string }>> = {
  vital_sign: { kind: 'vital_sign', table: 'vital_sign', at: 'measuredAt' },
  triage: { kind: 'triage', table: 'triage', at: 'triagedAt' },
  encounter: { kind: 'encounter', table: 'encounter', at: 'startedAt' },
  allergy: { kind: 'allergy', table: 'allergy', at: 'notedAt' },
  medical_history: { kind: 'history', table: 'medical_history', at: 'notedAt' },
  problem: { kind: 'problem', table: 'problem', at: 'notedAt' },
  clinical_note: { kind: 'note', table: 'clinical_note', at: 'signedAt' },
  diagnosis: { kind: 'diagnosis', table: 'diagnosis', at: 'diagnosedAt' },
  form_response: { kind: 'form_response', table: 'form_response', at: 'completedAt' },
};

async function recordClinicalEvent(
  tx: Tx,
  ctx: Ctx,
  entity: EntityName,
  state: EntityState,
): Promise<void> {
  const entry = TIMELINE[entity];
  const patientId = str(state.data.patientId);
  if (!entry || !patientId) return;
  await tx.insert(schema.clinicalEvent).values({
    id: uuidv7(),
    tenantId: ctx.tenantId,
    patientId,
    encounterId: str(state.data.encounterId),
    kind: entry.kind,
    refTable: entry.table,
    refId: state.id,
    occurredAt: new Date(String(state.data[entry.at] ?? new Date().toISOString())),
    authorId: state.createdBy || null,
    deviceId: state.deviceId || null,
    hlc: state.hlc || null,
    opId: state.opId || null,
    createdBy: state.createdBy || null,
  });
}

async function getEntity(tx: Tx, entity: EntityName, id: string): Promise<EntityState | null> {
  switch (entity) {
    case 'patient': {
      const [row] = await tx
        .select()
        .from(schema.patient)
        .where(eq(schema.patient.id, id))
        .limit(1);
      return row ? mappers.patient.toState(row) : null;
    }
    case 'vital_sign': {
      const [row] = await tx
        .select()
        .from(schema.vitalSign)
        .where(eq(schema.vitalSign.id, id))
        .limit(1);
      return row ? mappers.vital_sign.toState(row) : null;
    }
    case 'stock_movement': {
      const [row] = await tx
        .select()
        .from(schema.stockMovement)
        .where(eq(schema.stockMovement.id, id))
        .limit(1);
      return row ? mappers.stock_movement.toState(row) : null;
    }
    case 'patient_favorite': {
      const [row] = await tx
        .select()
        .from(schema.patientFavorite)
        .where(eq(schema.patientFavorite.id, id))
        .limit(1);
      return row ? mappers.patient_favorite.toState(row) : null;
    }
    case 'encounter': {
      const [row] = await tx
        .select()
        .from(schema.encounter)
        .where(eq(schema.encounter.id, id))
        .limit(1);
      return row ? mappers.encounter.toState(row) : null;
    }
    case 'queue_ticket': {
      const [row] = await tx
        .select()
        .from(schema.queueTicket)
        .where(eq(schema.queueTicket.id, id))
        .limit(1);
      return row ? mappers.queue_ticket.toState(row) : null;
    }
    case 'triage': {
      const [row] = await tx.select().from(schema.triage).where(eq(schema.triage.id, id)).limit(1);
      return row ? mappers.triage.toState(row) : null;
    }
    case 'appointment': {
      const [row] = await tx
        .select()
        .from(schema.appointment)
        .where(eq(schema.appointment.id, id))
        .limit(1);
      return row ? mappers.appointment.toState(row) : null;
    }
    case 'allergy': {
      const [row] = await tx
        .select()
        .from(schema.allergy)
        .where(eq(schema.allergy.id, id))
        .limit(1);
      return row ? mappers.allergy.toState(row) : null;
    }
    case 'medical_history': {
      const [row] = await tx
        .select()
        .from(schema.medicalHistory)
        .where(eq(schema.medicalHistory.id, id))
        .limit(1);
      return row ? mappers.medical_history.toState(row) : null;
    }
    case 'problem': {
      const [row] = await tx
        .select()
        .from(schema.problem)
        .where(eq(schema.problem.id, id))
        .limit(1);
      return row ? mappers.problem.toState(row) : null;
    }
    case 'clinical_note': {
      const [row] = await tx
        .select()
        .from(schema.clinicalNote)
        .where(eq(schema.clinicalNote.id, id))
        .limit(1);
      return row ? mappers.clinical_note.toState(row) : null;
    }
    case 'diagnosis': {
      const [row] = await tx
        .select()
        .from(schema.diagnosis)
        .where(eq(schema.diagnosis.id, id))
        .limit(1);
      return row ? mappers.diagnosis.toState(row) : null;
    }
    case 'program_enrollment': {
      const [row] = await tx
        .select()
        .from(schema.programEnrollment)
        .where(eq(schema.programEnrollment.id, id))
        .limit(1);
      return row ? mappers.program_enrollment.toState(row) : null;
    }
    case 'form_response': {
      const [row] = await tx
        .select()
        .from(schema.formResponse)
        .where(eq(schema.formResponse.id, id))
        .limit(1);
      return row ? mappers.form_response.toState(row) : null;
    }
    case 'break_glass': {
      const [row] = await tx
        .select()
        .from(schema.breakGlassEvent)
        .where(eq(schema.breakGlassEvent.id, id))
        .limit(1);
      return row ? mappers.break_glass.toState(row) : null;
    }
    case 'record_access': {
      const [row] = await tx
        .select()
        .from(schema.dataAccessLog)
        .where(eq(schema.dataAccessLog.id, id))
        .limit(1);
      return row ? mappers.record_access.toState(row) : null;
    }
  }
}

async function getEntities(tx: Tx, entity: EntityName, ids: string[]): Promise<EntityState[]> {
  if (ids.length === 0) return [];
  switch (entity) {
    case 'patient':
      return (await tx.select().from(schema.patient).where(inArray(schema.patient.id, ids))).map(
        (r) => mappers.patient.toState(r),
      );
    case 'vital_sign':
      return (
        await tx.select().from(schema.vitalSign).where(inArray(schema.vitalSign.id, ids))
      ).map((r) => mappers.vital_sign.toState(r));
    case 'stock_movement':
      return (
        await tx.select().from(schema.stockMovement).where(inArray(schema.stockMovement.id, ids))
      ).map((r) => mappers.stock_movement.toState(r));
    case 'patient_favorite':
      return (
        await tx
          .select()
          .from(schema.patientFavorite)
          .where(inArray(schema.patientFavorite.id, ids))
      ).map((r) => mappers.patient_favorite.toState(r));
    case 'encounter':
      return (
        await tx.select().from(schema.encounter).where(inArray(schema.encounter.id, ids))
      ).map((r) => mappers.encounter.toState(r));
    case 'queue_ticket':
      return (
        await tx.select().from(schema.queueTicket).where(inArray(schema.queueTicket.id, ids))
      ).map((r) => mappers.queue_ticket.toState(r));
    case 'triage':
      return (await tx.select().from(schema.triage).where(inArray(schema.triage.id, ids))).map(
        (r) => mappers.triage.toState(r),
      );
    case 'appointment':
      return (
        await tx.select().from(schema.appointment).where(inArray(schema.appointment.id, ids))
      ).map((r) => mappers.appointment.toState(r));
    case 'allergy':
      return (await tx.select().from(schema.allergy).where(inArray(schema.allergy.id, ids))).map(
        (r) => mappers.allergy.toState(r),
      );
    case 'medical_history':
      return (
        await tx.select().from(schema.medicalHistory).where(inArray(schema.medicalHistory.id, ids))
      ).map((r) => mappers.medical_history.toState(r));
    case 'problem':
      return (await tx.select().from(schema.problem).where(inArray(schema.problem.id, ids))).map(
        (r) => mappers.problem.toState(r),
      );
    case 'clinical_note':
      return (
        await tx.select().from(schema.clinicalNote).where(inArray(schema.clinicalNote.id, ids))
      ).map((r) => mappers.clinical_note.toState(r));
    case 'diagnosis':
      return (
        await tx.select().from(schema.diagnosis).where(inArray(schema.diagnosis.id, ids))
      ).map((r) => mappers.diagnosis.toState(r));
    case 'program_enrollment':
      return (
        await tx
          .select()
          .from(schema.programEnrollment)
          .where(inArray(schema.programEnrollment.id, ids))
      ).map((r) => mappers.program_enrollment.toState(r));
    case 'form_response':
      return (
        await tx.select().from(schema.formResponse).where(inArray(schema.formResponse.id, ids))
      ).map((r) => mappers.form_response.toState(r));
    case 'break_glass':
      return (
        await tx
          .select()
          .from(schema.breakGlassEvent)
          .where(inArray(schema.breakGlassEvent.id, ids))
      ).map((r) => mappers.break_glass.toState(r));
    case 'record_access':
      return (
        await tx.select().from(schema.dataAccessLog).where(inArray(schema.dataAccessLog.id, ids))
      ).map((r) => mappers.record_access.toState(r));
  }
}

/**
 * A form response must answer a published (or since archived) version of the
 * same form, with answers whose shape fits it. Obligations and visibility
 * depend on the workstation's context and were enforced there by the same engine.
 */
async function checkEntity(
  tx: Tx,
  entity: EntityName,
  payload: Record<string, unknown>,
): Promise<string | null> {
  if (entity !== 'form_response') return null;
  const [version] = await tx
    .select({
      status: schema.formVersion.status,
      definition: schema.formVersion.definition,
    })
    .from(schema.formVersion)
    .where(eq(schema.formVersion.id, String(payload.formVersionId)))
    .limit(1);
  if (!version || version.status === 'draft') return 'FORM_VERSION_UNKNOWN';
  const definition = formDefinition.safeParse(version.definition);
  if (!definition.success || definition.data.code !== payload.formCode) {
    return 'FORM_VERSION_UNKNOWN';
  }
  const state = evaluateForm(
    definition.data,
    record(payload.data) ?? {},
    { birthDate: null, sex: 'U', pregnant: false, vitals: {}, now: new Date() },
    { structural: true },
  );
  return state.complete ? null : 'FORM_RESPONSE_INVALID';
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
  const cause = (error as { cause?: unknown })?.cause ?? error;
  const pg = cause as { code?: string; constraint?: string };
  return pg?.code === '23505' && (pg.constraint === constraint || pg.constraint === undefined);
}

const AUDIT_ACTION: Record<string, string> = {
  create: 'create',
  update: 'update',
  append: 'create',
};

function syncTx(tx: Tx, ctx: Ctx): ServerSyncTx {
  return {
    async findOpResult(opId) {
      const [row] = await tx
        .select({ result: schema.opLog.result })
        .from(schema.opLog)
        .where(eq(schema.opLog.opId, opId))
        .limit(1);
      return row ? (row.result as OpResult) : null;
    },
    async saveOp(op: Operation, result: OpResult) {
      try {
        await tx.insert(schema.opLog).values({
          opId: op.opId,
          tenantId: ctx.tenantId,
          deviceId: op.deviceId,
          userId: op.userId,
          command: op.command,
          entity: op.entity,
          entityId: op.entityId,
          payload: op.payload as Record<string, unknown>,
          hlc: op.hlc,
          clientTs: new Date(op.clientTs),
          status: result.status,
          result,
          schemaVersion: op.schemaVersion,
          signature: op.signature,
          clockSuspect: op.clockSuspect === true,
        });
      } catch (error) {
        if (isUniqueViolation(error, 'op_log_pkey')) throw new DuplicateOperationError();
        throw error;
      }
      if (result.status !== 'rejected') {
        const kind = getCommand(op.command)?.kind ?? 'update';
        const payload = op.payload as Record<string, unknown>;
        await appendAudit(tx, {
          tenantId: ctx.tenantId,
          userId: op.userId,
          deviceId: op.deviceId,
          action:
            op.command === 'record_access.log'
              ? 'read'
              : op.command === 'break_glass.start'
                ? 'break_glass'
                : (AUDIT_ACTION[kind] ?? 'update'),
          entity: op.entity,
          entityId: op.entityId,
          patientId:
            op.entity === 'patient'
              ? op.entityId
              : typeof payload.patientId === 'string'
                ? payload.patientId
                : null,
          diff: { command: op.command, opId: op.opId, status: result.status },
        });
      }
    },
    getEntity: (entity, id) => getEntity(tx, entity, id),
    checkEntity: (entity, payload) => checkEntity(tx, entity, payload),
    async insertEntity(entity, state, op) {
      switch (entity) {
        case 'patient':
          await tx.insert(schema.patient).values(mappers.patient.toRow(state, ctx));
          // Duplicates are looked for in the background, so that a push stays short.
          await enqueue(
            tx,
            'pat.detect_duplicates',
            { patientId: state.id },
            {
              tenantId: ctx.tenantId,
            },
          );
          return;
        case 'vital_sign':
          await tx.insert(schema.vitalSign).values(mappers.vital_sign.toRow(state, ctx));
          await recordClinicalEvent(tx, ctx, 'vital_sign', state);
          return;
        case 'stock_movement':
          await tx.insert(schema.stockMovement).values(mappers.stock_movement.toRow(state, ctx));
          return;
        case 'patient_favorite':
          await tx
            .insert(schema.patientFavorite)
            .values(mappers.patient_favorite.toRow(state, ctx));
          return;
        case 'encounter':
          await tx.insert(schema.encounter).values(mappers.encounter.toRow(state, ctx));
          await recordClinicalEvent(tx, ctx, 'encounter', state);
          return;
        case 'queue_ticket':
          await tx.insert(schema.queueTicket).values(mappers.queue_ticket.toRow(state, ctx));
          return;
        case 'triage':
          await tx.insert(schema.triage).values(mappers.triage.toRow(state, ctx));
          await recordClinicalEvent(tx, ctx, 'triage', state);
          return;
        case 'appointment':
          await tx.insert(schema.appointment).values(mappers.appointment.toRow(state, ctx));
          return;
        case 'allergy':
          await tx.insert(schema.allergy).values(mappers.allergy.toRow(state, ctx));
          await recordClinicalEvent(tx, ctx, 'allergy', state);
          return;
        case 'medical_history':
          await tx.insert(schema.medicalHistory).values(mappers.medical_history.toRow(state, ctx));
          await recordClinicalEvent(tx, ctx, 'medical_history', state);
          return;
        case 'problem':
          await tx.insert(schema.problem).values(mappers.problem.toRow(state, ctx));
          await recordClinicalEvent(tx, ctx, 'problem', state);
          return;
        case 'clinical_note':
          await tx.insert(schema.clinicalNote).values({
            ...mappers.clinical_note.toRow(state, ctx),
            signedOperation: op
              ? (JSON.parse(JSON.stringify(op)) as Record<string, unknown>)
              : null,
          });
          await recordClinicalEvent(tx, ctx, 'clinical_note', state);
          return;
        case 'diagnosis':
          await tx.insert(schema.diagnosis).values(mappers.diagnosis.toRow(state, ctx));
          await recordClinicalEvent(tx, ctx, 'diagnosis', state);
          return;
        case 'form_response':
          await tx.insert(schema.formResponse).values(mappers.form_response.toRow(state, ctx));
          await recordClinicalEvent(tx, ctx, 'form_response', state);
          return;
        case 'program_enrollment':
          await tx
            .insert(schema.programEnrollment)
            .values(mappers.program_enrollment.toRow(state, ctx));
          return;
        case 'break_glass':
          await tx.insert(schema.breakGlassEvent).values(mappers.break_glass.toRow(state, ctx));
          // The person in charge sees it in the security journal and the review board.
          await recordSecurityEvent(tx, {
            kind: 'break_glass',
            severity: 'warning',
            tenantId: ctx.tenantId,
            userId: state.createdBy || null,
            ip: null,
            detail: { breakGlassId: state.id, reason: String(state.data.reasonCode) },
          });
          return;
        case 'record_access':
          await tx.insert(schema.dataAccessLog).values(mappers.record_access.toRow(state, ctx));
          await recordClinicalEvent(tx, ctx, 'record_access', state);
          return;
      }
    },
    async updateEntity(entity, state) {
      switch (entity) {
        case 'patient': {
          const before = await getEntity(tx, 'patient', state.id);
          const {
            id: _id,
            tenantId: _t,
            createdBy: _c,
            ...row
          } = mappers.patient.toRow(state, ctx);
          await tx.update(schema.patient).set(row).where(eq(schema.patient.id, state.id));
          // An identified provisional record is compared with the others only now.
          if (before?.data.isProvisional === true && state.data.isProvisional !== true) {
            await enqueue(
              tx,
              'pat.detect_duplicates',
              { patientId: state.id },
              { tenantId: ctx.tenantId },
            );
          }
          await recordFieldHistory(tx, {
            tenantId: ctx.tenantId,
            patientId: state.id,
            before: before?.data ?? {},
            after: state.data,
            source: 'sync',
            opId: state.opId || null,
            hlc: state.hlc || null,
            deviceId: ctx.deviceId,
            changedBy: ctx.userId,
          });
          return;
        }
        case 'vital_sign':
          await tx
            .update(schema.vitalSign)
            .set({
              status: String(state.data.status ?? 'active'),
              version: state.version,
              opId: state.opId,
            })
            .where(eq(schema.vitalSign.id, state.id));
          return;
        case 'encounter': {
          const {
            id: _id,
            tenantId: _t,
            createdBy: _c,
            ...row
          } = mappers.encounter.toRow(state, ctx);
          await tx.update(schema.encounter).set(row).where(eq(schema.encounter.id, state.id));
          return;
        }
        case 'queue_ticket': {
          const {
            id: _id,
            tenantId: _t,
            createdBy: _c,
            ...row
          } = mappers.queue_ticket.toRow(state, ctx);
          await tx.update(schema.queueTicket).set(row).where(eq(schema.queueTicket.id, state.id));
          return;
        }
        case 'appointment': {
          const {
            id: _id,
            tenantId: _t,
            createdBy: _c,
            ...row
          } = mappers.appointment.toRow(state, ctx);
          await tx.update(schema.appointment).set(row).where(eq(schema.appointment.id, state.id));
          return;
        }
        case 'triage':
          // Append-only: only the status changes, when a correction supersedes the row.
          await tx
            .update(schema.triage)
            .set({
              status: String(state.data.status ?? 'active'),
              version: state.version,
              opId: state.opId,
            })
            .where(eq(schema.triage.id, state.id));
          return;
        case 'allergy': {
          const {
            id: _id,
            tenantId: _t,
            createdBy: _c,
            ...row
          } = mappers.allergy.toRow(state, ctx);
          await tx.update(schema.allergy).set(row).where(eq(schema.allergy.id, state.id));
          return;
        }
        case 'medical_history': {
          const {
            id: _id,
            tenantId: _t,
            createdBy: _c,
            ...row
          } = mappers.medical_history.toRow(state, ctx);
          await tx
            .update(schema.medicalHistory)
            .set(row)
            .where(eq(schema.medicalHistory.id, state.id));
          return;
        }
        case 'problem': {
          const {
            id: _id,
            tenantId: _t,
            createdBy: _c,
            ...row
          } = mappers.problem.toRow(state, ctx);
          await tx.update(schema.problem).set(row).where(eq(schema.problem.id, state.id));
          return;
        }
        case 'stock_movement':
        case 'patient_favorite':
        case 'clinical_note':
          // Append-only: only the status changes, when a correction supersedes the row.
          await tx
            .update(schema.clinicalNote)
            .set({
              status: String(state.data.status ?? 'active'),
              version: state.version,
              opId: state.opId,
            })
            .where(eq(schema.clinicalNote.id, state.id));
          return;
        case 'diagnosis':
          // Append-only: only the status changes, when a correction supersedes the row.
          await tx
            .update(schema.diagnosis)
            .set({
              status: String(state.data.status ?? 'active'),
              version: state.version,
              opId: state.opId,
            })
            .where(eq(schema.diagnosis.id, state.id));
          return;
        case 'form_response':
          await tx
            .update(schema.formResponse)
            .set({
              status: String(state.data.status ?? 'active'),
              version: state.version,
              opId: state.opId,
            })
            .where(eq(schema.formResponse.id, state.id));
          return;
        case 'program_enrollment': {
          const {
            id: _id,
            tenantId: _t,
            createdBy: _c,
            ...row
          } = mappers.program_enrollment.toRow(state, ctx);
          await tx
            .update(schema.programEnrollment)
            .set(row)
            .where(eq(schema.programEnrollment.id, state.id));
          return;
        }
        case 'break_glass':
        case 'record_access':
          throw new Error(`${entity} rows are immutable`);
      }
    },
    async appendChange(change: ChangeEntry) {
      await tx.insert(schema.changeLog).values({
        tenantId: ctx.tenantId,
        entity: change.entity,
        entityId: change.entityId,
        version: change.version,
        opId: change.opId,
        scopeKeys: change.scopeKeys,
      });
    },
    async createConflict(conflict: ConflictEntry) {
      const id = uuidv7();
      await tx.insert(schema.syncConflict).values({
        id,
        tenantId: ctx.tenantId,
        entity: conflict.entity,
        entityId: conflict.entityId,
        opId: conflict.opId,
        kind: conflict.kind,
        serverValue: Object.fromEntries(conflict.conflicts.map((c) => [c.field, c.serverValue])),
        clientValue: Object.fromEntries(conflict.conflicts.map((c) => [c.field, c.clientValue])),
      });
      return id;
    },
    async slotCapacity(resourceId, startsAt) {
      const [tenant] = await tx
        .select({ timeZone: schema.tenant.timezone })
        .from(schema.tenant)
        .where(eq(schema.tenant.id, ctx.tenantId));
      const schedules = await tx
        .select()
        .from(schema.scheduleTemplate)
        .where(eq(schema.scheduleTemplate.resourceId, resourceId));
      const exceptions = await tx
        .select()
        .from(schema.scheduleException)
        .where(eq(schema.scheduleException.resourceId, resourceId));
      return slotCapacity({
        resourceId,
        startsAt,
        timeZone: tenant?.timeZone ?? 'Africa/Kinshasa',
        schedules,
        exceptions: exceptions.map((e) => ({ ...e, kind: e.kind as 'closed' | 'extra' })),
      });
    },
    async countSlotBookings(resourceId, startsAt, excludeId) {
      const rows = await tx
        .select({ id: schema.appointment.id })
        .from(schema.appointment)
        .where(
          and(
            eq(schema.appointment.resourceId, resourceId),
            eq(schema.appointment.startsAt, new Date(startsAt)),
            ne(schema.appointment.id, excludeId),
            inArray(schema.appointment.status, [...SLOT_HOLDING_STATUSES]),
          ),
        );
      return rows.length;
    },
    async listStockMovements(warehouseId, productId) {
      const rows = await tx
        .select({ kind: schema.stockMovement.kind, quantity: schema.stockMovement.quantity })
        .from(schema.stockMovement)
        .where(
          and(
            eq(schema.stockMovement.warehouseId, warehouseId),
            eq(schema.stockMovement.productId, productId),
          ),
        );
      return rows.map((r) => ({ kind: r.kind as StockMovementKind, quantity: r.quantity }));
    },
  };
}

/** PostgreSQL implementation of the sync engine ports, always inside withTenant. */
export function pgSyncStore(db: Db, ctx: Ctx): ServerSyncStore & ServerPullStore {
  const run = <T>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(db, { tenantId: ctx.tenantId, userId: ctx.userId, deviceId: ctx.deviceId }, fn);
  return {
    findOpResult: (opId) => run((tx) => syncTx(tx, ctx).findOpResult(opId)),
    transaction: (fn) => run((tx) => fn(syncTx(tx, ctx))),
    async listChangesAfter(afterSeq, limit) {
      return run(async (tx) => {
        const rows = await tx
          .select()
          .from(schema.changeLog)
          .where(gt(schema.changeLog.seq, afterSeq))
          .orderBy(asc(schema.changeLog.seq))
          .limit(limit);
        return rows.map(toChangeRow);
      });
    },
    async listRecentChanges(fromSeq, toSeq, sinceMs) {
      return run(async (tx) => {
        const rows = await tx
          .select()
          .from(schema.changeLog)
          .where(
            and(
              gt(schema.changeLog.seq, fromSeq),
              lte(schema.changeLog.seq, toSeq),
              gte(schema.changeLog.changedAt, new Date(sinceMs)),
            ),
          )
          .orderBy(asc(schema.changeLog.seq));
        return rows.map(toChangeRow);
      });
    },
    getEntities: (entity, ids) => run((tx) => getEntities(tx, entity, ids)),
  };
}

function toChangeRow(row: typeof schema.changeLog.$inferSelect): ChangeRow {
  return {
    seq: row.seq,
    entity: row.entity as EntityName,
    entityId: row.entityId,
    version: row.version,
    changedAtMs: row.changedAt.getTime(),
  };
}

export async function loadDevice(db: Db, ctx: Ctx, deviceId: string) {
  return withTenant(db, { tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const [row] = await tx
      .select()
      .from(schema.device)
      .where(eq(schema.device.id, deviceId))
      .limit(1);
    return row ?? null;
  });
}

export async function touchDevice(db: Db, ctx: Ctx, deviceId: string, synced: boolean) {
  await withTenant(db, { tenantId: ctx.tenantId, userId: ctx.userId }, (tx) =>
    tx
      .update(schema.device)
      .set({ lastSeenAt: new Date(), ...(synced ? { lastSyncAt: new Date() } : {}) })
      .where(eq(schema.device.id, deviceId)),
  );
}

export async function endDeviceSessions(db: Db, ctx: Ctx, deviceId: string) {
  await withTenant(db, { tenantId: ctx.tenantId, userId: ctx.userId }, (tx) =>
    tx
      .update(schema.session)
      .set({ revokedAt: new Date() })
      .where(and(eq(schema.session.deviceId, deviceId), isNull(schema.session.revokedAt))),
  );
}

/**
 * Patients created by the server itself (fictitious patients of a training
 * base): same row and change log entry as a synchronised registration, so that
 * devices download them with their next pull.
 */
export async function insertServerPatients(
  tx: Tx,
  ctx: { tenantId: string; userId: string },
  payloads: readonly PatientRegisterPayload[],
): Promise<number> {
  const node = 'server';
  let physical = Date.now();
  for (const payload of payloads) {
    const id = uuidv7();
    const opId = uuidv7();
    const hlc = formatHlc({ physical: physical++, counter: 0, node });
    const state = createState(
      'patient',
      id,
      { hlc, opId, deviceId: '', userId: ctx.userId, baseVersion: null },
      payload as unknown as Record<string, unknown>,
      1,
    );
    await tx
      .insert(schema.patient)
      .values(mappers.patient.toRow(state, { ...ctx, deviceId: null }));
    await tx.insert(schema.changeLog).values({
      tenantId: ctx.tenantId,
      entity: 'patient',
      entityId: id,
      version: 1,
      opId,
      scopeKeys: ENTITIES.patient.scopeKeys(state.data, id),
    });
  }
  return payloads.length;
}

/**
 * A change made by the server itself (merge, undo of a merge): a new version
 * with per-field metadata and a change log entry, exactly like a synchronised
 * update, so that every device receives it with its next pull.
 */
export async function updateServerPatient(
  tx: Tx,
  ctx: { tenantId: string; userId: string },
  patientId: string,
  patch: Record<string, unknown>,
  source: 'merge' | 'unmerge' | 'review' = 'merge',
): Promise<EntityState> {
  const [row] = await tx
    .select()
    .from(schema.patient)
    .where(eq(schema.patient.id, patientId))
    .limit(1);
  if (!row) throw new Error('patient not found');
  const current = mappers.patient.toState(row);
  const version = current.version + 1;
  const hlc = formatHlc({ physical: Date.now(), counter: 0, node: 'server' });
  const opId = uuidv7();
  const fieldMeta = { ...current.fieldMeta };
  for (const key of Object.keys(patch)) fieldMeta[key] = { hlc, v: version };
  const state: EntityState = {
    ...current,
    version,
    hlc,
    opId,
    fieldMeta,
    data: deriveData('patient', { ...current.data, ...patch }),
  };
  const {
    id: _id,
    tenantId: _t,
    createdBy: _c,
    ...values
  } = mappers.patient.toRow(state, { ...ctx, deviceId: null });
  await tx.update(schema.patient).set(values).where(eq(schema.patient.id, patientId));
  await recordFieldHistory(tx, {
    tenantId: ctx.tenantId,
    patientId,
    before: current.data,
    after: state.data,
    source,
    opId,
    hlc,
    deviceId: null,
    changedBy: ctx.userId,
  });
  await tx.insert(schema.changeLog).values({
    tenantId: ctx.tenantId,
    entity: 'patient',
    entityId: patientId,
    version,
    opId,
    scopeKeys: ENTITIES.patient.scopeKeys(state.data, patientId),
  });
  return state;
}

/** Current state of a patient, as a pull would deliver it. */
export async function patientState(tx: Tx, patientId: string): Promise<EntityState | null> {
  return getEntity(tx, 'patient', patientId);
}

/**
 * Every row a device needs for these patients: the record itself, its vital
 * signs and the user's own favourite toggles, as pull changes.
 */
export async function patientBundles(
  tx: Tx,
  patientIds: readonly string[],
  userId: string,
): Promise<{ entity: EntityName; state: EntityState }[]> {
  if (patientIds.length === 0) return [];
  const ids = [...patientIds];
  const patients = await tx.select().from(schema.patient).where(inArray(schema.patient.id, ids));
  const vitals = await tx
    .select()
    .from(schema.vitalSign)
    .where(inArray(schema.vitalSign.patientId, ids));
  const favorites = await tx
    .select()
    .from(schema.patientFavorite)
    .where(
      and(
        inArray(schema.patientFavorite.patientId, ids),
        eq(schema.patientFavorite.userId, userId),
      ),
    );
  const encounters = await tx
    .select()
    .from(schema.encounter)
    .where(inArray(schema.encounter.patientId, ids));
  const tickets = await tx
    .select()
    .from(schema.queueTicket)
    .where(inArray(schema.queueTicket.patientId, ids));
  const triages = await tx
    .select()
    .from(schema.triage)
    .where(inArray(schema.triage.patientId, ids));
  const appointments = await tx
    .select()
    .from(schema.appointment)
    .where(inArray(schema.appointment.patientId, ids));
  const allergies = await tx
    .select()
    .from(schema.allergy)
    .where(inArray(schema.allergy.patientId, ids));
  const histories = await tx
    .select()
    .from(schema.medicalHistory)
    .where(inArray(schema.medicalHistory.patientId, ids));
  const problems = await tx
    .select()
    .from(schema.problem)
    .where(inArray(schema.problem.patientId, ids));
  const notes = await tx
    .select()
    .from(schema.clinicalNote)
    .where(inArray(schema.clinicalNote.patientId, ids));
  const diagnoses = await tx
    .select()
    .from(schema.diagnosis)
    .where(inArray(schema.diagnosis.patientId, ids));
  const enrollments = await tx
    .select()
    .from(schema.programEnrollment)
    .where(inArray(schema.programEnrollment.patientId, ids));
  const responses = await tx
    .select()
    .from(schema.formResponse)
    .where(inArray(schema.formResponse.patientId, ids));
  return [
    ...patients.map((r) => ({ entity: 'patient' as const, state: mappers.patient.toState(r) })),
    ...triages.map((r) => ({ entity: 'triage' as const, state: mappers.triage.toState(r) })),
    ...allergies.map((r) => ({ entity: 'allergy' as const, state: mappers.allergy.toState(r) })),
    ...histories.map((r) => ({
      entity: 'medical_history' as const,
      state: mappers.medical_history.toState(r),
    })),
    ...problems.map((r) => ({ entity: 'problem' as const, state: mappers.problem.toState(r) })),
    ...notes.map((r) => ({
      entity: 'clinical_note' as const,
      state: mappers.clinical_note.toState(r),
    })),
    ...diagnoses.map((r) => ({
      entity: 'diagnosis' as const,
      state: mappers.diagnosis.toState(r),
    })),
    ...responses.map((r) => ({
      entity: 'form_response' as const,
      state: mappers.form_response.toState(r),
    })),
    ...enrollments.map((r) => ({
      entity: 'program_enrollment' as const,
      state: mappers.program_enrollment.toState(r),
    })),
    ...appointments.map((r) => ({
      entity: 'appointment' as const,
      state: mappers.appointment.toState(r),
    })),
    ...encounters.map((r) => ({
      entity: 'encounter' as const,
      state: mappers.encounter.toState(r),
    })),
    ...tickets.map((r) => ({
      entity: 'queue_ticket' as const,
      state: mappers.queue_ticket.toState(r),
    })),
    ...vitals.map((r) => ({ entity: 'vital_sign' as const, state: mappers.vital_sign.toState(r) })),
    ...favorites.map((r) => ({
      entity: 'patient_favorite' as const,
      state: mappers.patient_favorite.toState(r),
    })),
  ];
}
