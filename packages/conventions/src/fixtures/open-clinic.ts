import type { PlanRulesInput } from '../schema';

/**
 * Demonstration plans after the reference contracts of Open Clinic asbl
 * (docs/modules/conv.md section 1, owner decision S11). Prices, package days
 * and guarantees come from that table; the lists of acts are reduced to the
 * demo nomenclature and stay fictitious until the real lists are imported.
 */
export const DEMO_SERVICES = [
  { code: 'CONS-GEN', name: 'Consultation générale', category: 'consultation' },
  { code: 'CONS-SPE', name: 'Consultation spécialisée', category: 'consultation' },
  { code: 'LAB-BASE', name: 'Laboratoire de base', category: 'lab' },
  { code: 'LAB-EXT', name: 'Laboratoire étendu', category: 'lab' },
  { code: 'ECHO-OBS', name: 'Échographie obstétricale', category: 'imaging' },
  { code: 'ECHO', name: 'Échographie', category: 'imaging' },
  { code: 'RADIO', name: 'Radiographie standard', category: 'imaging' },
  { code: 'SCANNER', name: 'Scanner', category: 'imaging' },
  { code: 'ECG', name: 'Électrocardiogramme', category: 'procedure' },
  { code: 'ACCOUCH', name: 'Accouchement', category: 'procedure' },
  { code: 'CESAR', name: 'Césarienne', category: 'procedure' },
  { code: 'CHIR-MAJ', name: 'Grande chirurgie', category: 'procedure' },
  { code: 'KINE', name: 'Séance de kinésithérapie', category: 'procedure' },
  { code: 'DENT', name: 'Soins dentaires', category: 'procedure' },
  { code: 'VERRES', name: 'Verres correcteurs', category: 'other' },
  { code: 'HOSP-J', name: "Journée d'hospitalisation", category: 'bed_day' },
  { code: 'MED', name: 'Médicaments', category: 'drug' },
] as const;

const include = (id: string, serviceCodes: string[]) => ({
  id,
  match: { serviceCodes },
  coverage: 'included' as const,
});
const exclude = (id: string, serviceCodes: string[], priorAuthorization = false) => ({
  id,
  match: { serviceCodes },
  coverage: 'excluded' as const,
  priorAuthorization,
  action: 'block' as const,
});

const BASE_A = ['CONS-GEN', 'LAB-BASE', 'ECHO-OBS', 'ECG', 'HOSP-J', 'MED'];
const BASE_B = [...BASE_A, 'ACCOUCH', 'RADIO', 'ECHO'];
const BASE_C = [...BASE_B, 'CESAR', 'CONS-SPE', 'KINE', 'DENT', 'VERRES', 'LAB-EXT'];

export const PLAN_A: PlanRulesInput = {
  code: 'A',
  name: 'KITOKO (Bien-être)',
  currency: 'USD',
  billing: 'family_monthly_package',
  price: 5500,
  hospitalization: { packageDays: 3, justificationRequired: true },
  rules: [
    include('plateau-minimum', BASE_A),
    exclude('accouchements', ['ACCOUCH', 'CESAR']),
    exclude('grandes-chirurgies', ['CHIR-MAJ']),
  ],
  default: { coverage: 'excluded', action: 'warn' },
};

export const PLAN_B: PlanRulesInput = {
  code: 'B',
  name: 'SEPELA (Joie de vivre)',
  currency: 'USD',
  billing: 'family_monthly_package',
  price: 7500,
  guaranteePerWorker: 7500,
  hospitalization: { packageDays: 5, justificationRequired: true },
  caps: [
    {
      id: 'medicaments-annee',
      scope: 'beneficiary',
      period: 'year',
      amount: 200000,
      categories: ['drug'],
    },
  ],
  rules: [
    include('plateau-semi-complet', BASE_B),
    exclude('imagerie-lourde', ['SCANNER'], true),
    exclude('chirurgie', ['CESAR', 'CHIR-MAJ'], true),
  ],
  default: { coverage: 'excluded', action: 'warn' },
};

export const PLAN_C: PlanRulesInput = {
  code: 'C',
  name: 'ELENGI (Mieux vivre)',
  currency: 'USD',
  billing: 'family_monthly_package',
  price: 10000,
  hospitalization: { packageDays: 7, justificationRequired: true },
  rules: [
    include('plateau-complet', BASE_C),
    exclude('imagerie-lourde', ['SCANNER'], true),
    exclude('grandes-chirurgies', ['CHIR-MAJ'], true),
  ],
  default: { coverage: 'excluded', action: 'warn' },
};

export const PLAN_D: PlanRulesInput = {
  code: 'D',
  name: 'À facturer',
  currency: 'USD',
  billing: 'per_act',
  price: 0,
  guaranteePerWorker: 10000,
  hospitalization: { packageDays: 3, justificationRequired: true },
  rules: [exclude('orientation-medecin-conseil', ['SCANNER', 'CHIR-MAJ'], true)],
  default: { coverage: 'included', action: 'warn' },
};

export const OPEN_CLINIC_PLANS = [PLAN_A, PLAN_B, PLAN_C, PLAN_D];
