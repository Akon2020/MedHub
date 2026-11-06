import type { CsvTable } from '@medhub/shared';
import { z } from 'zod';

/**
 * Payers, contracts and beneficiaries (docs/modules/conv.md section 2).
 * Configuration and imports are online; linking a patient to a beneficiary
 * works offline at the front desk.
 */
export const PAYER_KINDS = ['company', 'insurer', 'mutual', 'ngo', 'public_program'] as const;
export const CONTRACT_STATUSES = ['draft', 'active', 'suspended', 'terminated'] as const;
export const BENEFICIARY_ROLES = ['holder', 'spouse', 'child', 'dependent'] as const;
export type BeneficiaryRole = (typeof BENEFICIARY_ROLES)[number];

const code = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9_-]{0,19}$/);

export const payerInput = z.object({
  id: z.uuid().nullish(),
  code,
  name: z.string().trim().min(2).max(160),
  kind: z.enum(PAYER_KINDS),
  contact: z
    .object({
      person: z.string().trim().max(120).nullish(),
      phone: z.string().trim().max(40).nullish(),
      email: z.string().trim().max(160).nullish(),
      address: z.string().trim().max(300).nullish(),
      medicalAdviser: z.string().trim().max(120).nullish(),
    })
    .default({}),
  paymentTermDays: z.number().int().min(0).max(365).default(30),
  isActive: z.boolean().default(true),
});
export type PayerInput = z.infer<typeof payerInput>;

export const contractInput = z.object({
  id: z.uuid().nullish(),
  payerId: z.uuid(),
  code,
  name: z.string().trim().min(2).max(160),
  currency: z.string().regex(/^[A-Z]{3}$/),
  validFrom: z.iso.date(),
  validUntil: z.iso.date().nullish(),
  invoiceDay: z.number().int().min(1).max(31).default(25),
  priceListId: z.uuid().nullish(),
});
export type ContractInput = z.infer<typeof contractInput>;

export type BeneficiaryRow = {
  memberNumber: string;
  familyNumber: string;
  fullName: string;
  role: BeneficiaryRole;
  planCode: string;
  birthDate: string | null;
  validFrom: string;
  validUntil: string | null;
  isDayLaborer: boolean;
};

export type BeneficiaryImportError = { line: number; message: string };

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');

const ROLE_WORDS: Record<string, BeneficiaryRole> = {
  titulaire: 'holder',
  agent: 'holder',
  holder: 'holder',
  conjoint: 'spouse',
  epoux: 'spouse',
  epouse: 'spouse',
  spouse: 'spouse',
  enfant: 'child',
  child: 'child',
  autre: 'dependent',
  ayant_droit: 'dependent',
  dependent: 'dependent',
};
const YES = new Set(['oui', 'yes', 'o', 'y', '1', 'x', 'vrai', 'true']);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Beneficiary list of the payer (CSV): matricule, famille (worker's
 * matricule, empty for the worker), nom, role, plan, naissance, debut, fin,
 * journalier. Checked line by line before anything is saved.
 */
export function parseBeneficiaries(
  table: CsvTable,
  planCodes: readonly string[],
): { items: BeneficiaryRow[]; errors: BeneficiaryImportError[] } {
  const header = table.header.map(fold);
  const items: BeneficiaryRow[] = [];
  const errors: BeneficiaryImportError[] = [];
  for (const required of ['matricule', 'nom', 'plan', 'debut']) {
    if (!header.includes(required))
      return { items, errors: [{ line: 1, message: 'CONV_IMPORT_COLUMNS' }] };
  }
  const get = (cells: string[], ...names: string[]) => {
    for (const n of names) {
      const i = header.indexOf(n);
      if (i >= 0) return (cells[i] ?? '').trim();
    }
    return '';
  };
  const seen = new Set<string>();
  const lineOf = new Map<string, number>();
  for (const { line, cells } of table.rows) {
    const memberNumber = get(cells, 'matricule').toUpperCase();
    const fullName = get(cells, 'nom');
    const planCode = get(cells, 'plan').toUpperCase();
    const validFrom = get(cells, 'debut');
    const validUntil = get(cells, 'fin') || null;
    const birthDate = get(cells, 'naissance', 'date_naissance') || null;
    const roleWord = fold(get(cells, 'role', 'lien'));
    const role = roleWord ? ROLE_WORDS[roleWord] : 'holder';
    const familyNumber = (
      get(cells, 'famille', 'matricule_titulaire') || memberNumber
    ).toUpperCase();
    if (!memberNumber || fullName.length < 2 || !planCode || !validFrom) {
      errors.push({ line, message: 'CONV_IMPORT_MISSING' });
      continue;
    }
    if (
      !role ||
      !DAY.test(validFrom) ||
      (validUntil && (!DAY.test(validUntil) || validUntil < validFrom)) ||
      (birthDate && !DAY.test(birthDate))
    ) {
      errors.push({ line, message: 'CONV_IMPORT_VALUE' });
      continue;
    }
    if (!planCodes.includes(planCode)) {
      errors.push({ line, message: 'CONV_IMPORT_UNKNOWN_PLAN' });
      continue;
    }
    if (seen.has(memberNumber)) {
      errors.push({ line, message: 'CONV_IMPORT_DUPLICATE' });
      continue;
    }
    seen.add(memberNumber);
    lineOf.set(memberNumber, line);
    items.push({
      memberNumber,
      familyNumber,
      fullName: fullName.slice(0, 160),
      role: role === 'holder' && familyNumber !== memberNumber ? 'dependent' : role,
      planCode,
      birthDate,
      validFrom,
      validUntil,
      isDayLaborer: YES.has(get(cells, 'journalier').toLowerCase()),
    });
  }
  // A dependant must belong to a worker of the file.
  const holders = new Set(
    items.filter((i) => i.familyNumber === i.memberNumber).map((i) => i.memberNumber),
  );
  return {
    items: items.filter((i) => {
      if (holders.has(i.familyNumber)) return true;
      errors.push({ line: lineOf.get(i.memberNumber) ?? 0, message: 'CONV_IMPORT_NO_HOLDER' });
      return false;
    }),
    errors: errors.sort((a, b) => a.line - b.line),
  };
}

export type ExistingBeneficiary = BeneficiaryRow & { id: string; status: string };

/**
 * Differences between the list held and the payer's file (report shown
 * before applying): entries, changes, and members absent from the file who
 * leave on the effective day when the file is the complete list.
 */
export function diffBeneficiaries(
  existing: readonly ExistingBeneficiary[],
  incoming: readonly BeneficiaryRow[],
  options: { completeList: boolean },
): {
  entries: BeneficiaryRow[];
  changes: { id: string; before: BeneficiaryRow; after: BeneficiaryRow; fields: string[] }[];
  exits: ExistingBeneficiary[];
} {
  const byNumber = new Map(existing.map((e) => [e.memberNumber, e]));
  const entries: BeneficiaryRow[] = [];
  const changes: { id: string; before: BeneficiaryRow; after: BeneficiaryRow; fields: string[] }[] =
    [];
  const fields: (keyof BeneficiaryRow)[] = [
    'familyNumber',
    'fullName',
    'role',
    'planCode',
    'birthDate',
    'validFrom',
    'validUntil',
    'isDayLaborer',
  ];
  for (const row of incoming) {
    const before = byNumber.get(row.memberNumber);
    if (!before || before.status === 'left') {
      entries.push(row);
      continue;
    }
    const diff = fields.filter((f) => before[f] !== row[f]);
    if (diff.length > 0) changes.push({ id: before.id, before, after: row, fields: diff });
  }
  const present = new Set(incoming.map((r) => r.memberNumber));
  const exits = options.completeList
    ? existing.filter((e) => e.status !== 'left' && !present.has(e.memberNumber))
    : [];
  return { entries, changes, exits };
}

export const patientCoverageLinkPayload = z.object({
  patientId: z.uuid(),
  contractId: z.uuid(),
  beneficiaryId: z.uuid(),
  linkedAt: z.iso.datetime(),
  status: z.literal('active').default('active'),
});

export const patientCoverageEndPayload = z.object({
  status: z.literal('ended').default('ended'),
  unlinkReason: z.string().trim().min(3).max(300),
});

/** Accent-insensitive search of beneficiaries by name or member number. */
export function searchBeneficiaries<T extends { fullName: string; memberNumber: string }>(
  items: readonly T[],
  query: string,
  limit = 10,
): T[] {
  const q = fold(query);
  if (q.length < 2) return [];
  const words = q.split('_');
  return items
    .filter((b) => {
      const hay = fold(`${b.fullName} ${b.memberNumber}`);
      return words.every((w) => hay.includes(w));
    })
    .slice(0, limit);
}
