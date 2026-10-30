/**
 * Permission catalog (docs/05-roles-permissions.md section 3). Role templates
 * below are seeded as platform templates and copied into each structure, where
 * administrators can change them freely.
 */
export const PERMISSION_CATALOG: Record<string, readonly string[]> = {
  patient: ['read', 'create', 'update', 'merge', 'export', 'mark_sensitive'],
  encounter: ['read', 'create', 'update_status', 'close'],
  appointment: ['read', 'create', 'update', 'cancel'],
  queue: ['read', 'call', 'manage'],
  triage: ['read', 'create'],
  clinical_record: ['read', 'create', 'correct', 'sign', 'break_glass', 'read_sensitive'],
  vital_sign: ['read', 'create', 'override_plausibility'],
  diagnosis: ['read', 'create'],
  prescription: ['read', 'create', 'update', 'cancel', 'override_alert'],
  medication_administration: ['read', 'create'],
  lab_order: ['read', 'create', 'cancel'],
  lab_result: ['read', 'enter', 'tech_validate', 'bio_validate', 'correct'],
  dispensation: ['read', 'create', 'void'],
  stock: ['read', 'move', 'transfer', 'count', 'adjust', 'receive', 'order'],
  controlled_substance: ['read', 'move', 'cosign'],
  invoice: ['read', 'create', 'add_line', 'finalize', 'void', 'discount', 'print'],
  payment: ['read', 'receive', 'refund'],
  cash_session: ['open', 'close', 'withdraw', 'review', 'reconcile'],
  price: ['read', 'manage', 'publish'],
  contract: ['read', 'create', 'update', 'activate', 'simulate'],
  beneficiary: ['read', 'import', 'update'],
  prior_authorization: ['read', 'request', 'decide'],
  payer_invoice: ['read', 'generate', 'send', 'record_payment', 'handle_rejection'],
  form: ['read', 'design', 'publish'],
  configuration: ['read', 'edit', 'publish'],
  user: ['read', 'create', 'update', 'disable', 'delegate', 'reset_password'],
  role: ['read', 'manage'],
  device: ['read', 'revoke', 'register'],
  report: ['read', 'create', 'export', 'schedule'],
  audit: ['read', 'export', 'review'],
  account: ['read', 'pay', 'change_plan'],
  support: ['create_ticket', 'grant_remote_access'],
  approval: ['decide'],
};

export const ALL_PERMISSION_KEYS: readonly string[] = Object.entries(PERMISSION_CATALOG).flatMap(
  ([resource, actions]) => actions.map((action) => `${resource}:${action}`),
);

export type RoleTemplate = {
  code: string;
  name: { fr: string; en: string };
  isPrivileged: boolean;
  requiresMfa: boolean;
  permissions: readonly string[];
};

const read = (resources: readonly string[]) => resources.map((r) => `${r}:read`);

export const ROLE_TEMPLATES: readonly RoleTemplate[] = [
  {
    code: 'tenant_admin',
    name: { fr: 'Administrateur de structure', en: 'Facility administrator' },
    isPrivileged: true,
    requiresMfa: true,
    permissions: [
      ...ALL_PERMISSION_KEYS.filter(
        (k) =>
          k.startsWith('configuration:') ||
          k.startsWith('user:') ||
          k.startsWith('role:') ||
          k.startsWith('device:') ||
          k.startsWith('audit:') ||
          k.startsWith('account:') ||
          k.startsWith('support:') ||
          k.startsWith('patient:') ||
          k.startsWith('form:') ||
          k.startsWith('price:'),
      ),
      ...read(['invoice', 'payment', 'stock', 'prescription', 'lab_result', 'report']),
    ],
  },
  {
    code: 'director',
    name: { fr: 'Direction', en: 'Management' },
    isPrivileged: true,
    requiresMfa: true,
    permissions: [
      ...read(['report', 'invoice', 'payment', 'stock', 'patient', 'audit']),
      'report:export',
      'audit:review',
      'approval:decide',
      'invoice:discount',
      'invoice:void',
      'device:register',
    ],
  },
  {
    code: 'receptionist',
    name: { fr: 'Accueil', en: 'Front desk' },
    isPrivileged: false,
    requiresMfa: false,
    permissions: [
      'patient:read',
      'patient:create',
      'patient:update',
      'appointment:read',
      'appointment:create',
      'appointment:update',
      'appointment:cancel',
      'queue:read',
      'queue:call',
      'encounter:read',
      'encounter:create',
      'contract:read',
      'invoice:read',
      'device:register',
    ],
  },
  {
    code: 'nurse',
    name: { fr: 'Infirmier', en: 'Nurse' },
    isPrivileged: false,
    requiresMfa: false,
    permissions: [
      'patient:read',
      'triage:read',
      'triage:create',
      'vital_sign:read',
      'vital_sign:create',
      'clinical_record:read',
      'clinical_record:create',
      'medication_administration:read',
      'medication_administration:create',
      'prescription:read',
      'lab_result:read',
      'stock:read',
      'queue:read',
      'queue:call',
      'device:register',
    ],
  },
  {
    code: 'physician',
    name: { fr: 'Médecin', en: 'Physician' },
    isPrivileged: false,
    requiresMfa: false,
    permissions: [
      'patient:read',
      'encounter:read',
      'encounter:update_status',
      'encounter:close',
      'clinical_record:read',
      'clinical_record:create',
      'clinical_record:correct',
      'clinical_record:sign',
      'clinical_record:break_glass',
      'vital_sign:read',
      'vital_sign:create',
      'vital_sign:override_plausibility',
      'diagnosis:read',
      'diagnosis:create',
      'prescription:read',
      'prescription:create',
      'prescription:update',
      'prescription:cancel',
      'prescription:override_alert',
      'lab_order:read',
      'lab_order:create',
      'lab_result:read',
      'stock:read',
      'invoice:read',
      'queue:read',
      'queue:call',
      'device:register',
    ],
  },
  {
    code: 'lab_tech',
    name: { fr: 'Technicien de laboratoire', en: 'Lab technician' },
    isPrivileged: false,
    requiresMfa: false,
    permissions: [
      'patient:read',
      'lab_order:read',
      'lab_result:read',
      'lab_result:enter',
      'lab_result:tech_validate',
      'device:register',
    ],
  },
  {
    code: 'pharmacist',
    name: { fr: 'Pharmacien', en: 'Pharmacist' },
    isPrivileged: false,
    requiresMfa: false,
    permissions: [
      'patient:read',
      'prescription:read',
      'dispensation:read',
      'dispensation:create',
      ...ALL_PERMISSION_KEYS.filter(
        (k) => k.startsWith('stock:') || k.startsWith('controlled_substance:'),
      ),
      'invoice:create',
      'device:register',
    ],
  },
  {
    code: 'cashier',
    name: { fr: 'Caissier', en: 'Cashier' },
    isPrivileged: false,
    requiresMfa: false,
    permissions: [
      'patient:read',
      'invoice:read',
      'invoice:add_line',
      'invoice:finalize',
      'invoice:print',
      'payment:read',
      'payment:receive',
      'cash_session:open',
      'cash_session:close',
      'device:register',
    ],
  },
];
