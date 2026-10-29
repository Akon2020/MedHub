export const TENANT_TYPES = [
  'pharmacy',
  'health_center',
  'practice',
  'laboratory',
  'imaging_center',
  'clinic',
  'hospital',
  'network',
] as const;
export type TenantType = (typeof TENANT_TYPES)[number];

export const TENANT_STATUSES = [
  'prospect',
  'trial',
  'active',
  'past_due',
  'grace',
  'read_only',
  'suspended',
  'terminated',
  'archived',
] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

export const USER_STATUSES = ['active', 'disabled', 'locked'] as const;
export const DEVICE_KINDS = ['desktop', 'laptop', 'tablet', 'phone'] as const;
export type DeviceKind = (typeof DEVICE_KINDS)[number];
export const DEVICE_STATUSES = ['active', 'revoked', 'lost'] as const;
export const SEXES = ['M', 'F', 'U'] as const;
export type Sex = (typeof SEXES)[number];
export const PATIENT_SENSITIVITIES = ['normal', 'staff', 'vip', 'restricted'] as const;
export const CLINICAL_STATUSES = ['active', 'superseded', 'entered_in_error'] as const;
export type ClinicalStatus = (typeof CLINICAL_STATUSES)[number];

export const OP_STATUSES = ['applied', 'merged', 'duplicate', 'rejected', 'needs_review'] as const;
export type OpStatus = (typeof OP_STATUSES)[number];

export const CONFLICT_STRATEGIES = [
  'append_only',
  'field_merge',
  'union',
  'movements',
  'immutable_ledger',
  'review_merge',
  'first_wins',
  'server_authority',
] as const;
export type ConflictStrategy = (typeof CONFLICT_STRATEGIES)[number];

export const JOB_STATUSES = ['queued', 'running', 'done', 'failed', 'dead'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const STOCK_MOVEMENT_KINDS = [
  'receipt',
  'dispense',
  'sale',
  'transfer_out',
  'transfer_in',
  'return_supplier',
  'return_patient',
  'adjustment_plus',
  'adjustment_minus',
  'destruction',
  'consumption',
  'count_correction',
] as const;
export type StockMovementKind = (typeof STOCK_MOVEMENT_KINDS)[number];

/** Movement kinds that add to the balance; every other kind subtracts. */
export const STOCK_INBOUND_KINDS: ReadonlySet<StockMovementKind> = new Set<StockMovementKind>([
  'receipt',
  'transfer_in',
  'return_patient',
  'adjustment_plus',
]);

export const VITAL_SIGN_CODES = [
  'temp',
  'pulse',
  'sbp',
  'dbp',
  'rr',
  'spo2',
  'weight',
  'height',
  'head_circ',
  'muac',
  'glucose',
  'pain',
  'diuresis',
] as const;
export type VitalSignCode = (typeof VITAL_SIGN_CODES)[number];
