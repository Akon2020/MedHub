export type ModulePhase = 'mvp' | 'phase2' | 'phase3';

export type ModuleManifest = {
  code: string;
  name: { fr: string; en: string };
  phase: ModulePhase;
  dependsOn: readonly string[];
  alwaysOn?: boolean;
};

export const MODULES: readonly ModuleManifest[] = [
  { code: 'core', name: { fr: 'Noyau', en: 'Core' }, phase: 'mvp', dependsOn: [], alwaysOn: true },
  { code: 'pat', name: { fr: 'Patients', en: 'Patients' }, phase: 'mvp', dependsOn: ['core'] },
  {
    code: 'rdv',
    name: { fr: 'Rendez-vous et files', en: 'Appointments and queues' },
    phase: 'mvp',
    dependsOn: ['pat'],
  },
  {
    code: 'dpi',
    name: { fr: 'Dossier patient', en: 'Patient record' },
    phase: 'mvp',
    dependsOn: ['pat'],
  },
  { code: 'form', name: { fr: 'Formulaires', en: 'Forms' }, phase: 'mvp', dependsOn: ['core'] },
  {
    code: 'fact',
    name: { fr: 'Facturation et caisse', en: 'Billing and cash' },
    phase: 'mvp',
    dependsOn: ['pat'],
  },
  { code: 'conv', name: { fr: 'Conventions', en: 'Contracts' }, phase: 'mvp', dependsOn: ['fact'] },
  {
    code: 'phar',
    name: { fr: 'Pharmacie et stock', en: 'Pharmacy and stock' },
    phase: 'mvp',
    dependsOn: ['core'],
  },
  { code: 'lab', name: { fr: 'Laboratoire', en: 'Laboratory' }, phase: 'mvp', dependsOn: ['dpi'] },
  {
    code: 'notif',
    name: { fr: 'Notifications et documents', en: 'Notifications and documents' },
    phase: 'mvp',
    dependsOn: ['core'],
  },
  {
    code: 'sadm',
    name: { fr: 'Super-administration', en: 'Platform administration' },
    phase: 'mvp',
    dependsOn: ['core'],
  },
  {
    code: 'hosp',
    name: { fr: 'Hospitalisation', en: 'Inpatient care' },
    phase: 'phase2',
    dependsOn: ['dpi', 'fact'],
  },
  { code: 'mat', name: { fr: 'Maternité', en: 'Maternity' }, phase: 'phase2', dependsOn: ['hosp'] },
  { code: 'img', name: { fr: 'Imagerie', en: 'Imaging' }, phase: 'phase2', dependsOn: ['dpi'] },
  {
    code: 'vac',
    name: { fr: 'Vaccination', en: 'Immunization' },
    phase: 'phase2',
    dependsOn: ['dpi', 'phar'],
  },
  {
    code: 'share',
    name: { fr: 'Partage inter-structures', en: 'Cross-facility sharing' },
    phase: 'phase2',
    dependsOn: ['dpi'],
  },
  {
    code: 'port',
    name: { fr: 'Portail patient', en: 'Patient portal' },
    phase: 'phase2',
    dependsOn: ['share'],
  },
  {
    code: 'mpay',
    name: { fr: 'Mobile money', en: 'Mobile money' },
    phase: 'phase2',
    dependsOn: ['fact'],
  },
  {
    code: 'epid',
    name: { fr: 'Santé publique', en: 'Public health' },
    phase: 'phase2',
    dependsOn: ['dpi'],
  },
  {
    code: 'ana',
    name: { fr: 'Analytique', en: 'Analytics' },
    phase: 'phase2',
    dependsOn: ['core'],
  },
  {
    code: 'rh',
    name: { fr: 'Personnel et gardes', en: 'Staff and rosters' },
    phase: 'phase2',
    dependsOn: ['core'],
  },
];

export function missingDependencies(code: string, enabled: ReadonlySet<string>): string[] {
  const manifest = MODULES.find((m) => m.code === code);
  if (!manifest) throw new Error('MODULE_UNKNOWN');
  return manifest.dependsOn.filter((dep) => !enabled.has(dep));
}
