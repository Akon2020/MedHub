/**
 * Platform reference data shipped with MedHub. Each list cites its source:
 * nothing here is a business value to be decided by the project owner.
 */

/** ISO 4217: code, minor unit. Symbols as used locally. */
export const CURRENCIES = [
  { code: 'USD', nameFr: 'Dollar américain', nameEn: 'US dollar', minorUnit: 2, symbol: '$' },
  { code: 'CDF', nameFr: 'Franc congolais', nameEn: 'Congolese franc', minorUnit: 2, symbol: 'FC' },
] as const;

export const UNIT_KINDS = [
  'mass',
  'volume',
  'length',
  'temperature',
  'pressure',
  'rate',
  'ratio',
  'concentration',
  'count',
  'time',
] as const;
export type UnitKind = (typeof UNIT_KINDS)[number];

/** UCUM codes (Unified Code for Units of Measure) of the units used by vitals and results. */
export const UNITS: readonly {
  code: string;
  kind: UnitKind;
  symbol: string;
  labelFr: string;
  labelEn: string;
}[] = [
  { code: 'kg', kind: 'mass', symbol: 'kg', labelFr: 'kilogramme', labelEn: 'kilogram' },
  { code: 'g', kind: 'mass', symbol: 'g', labelFr: 'gramme', labelEn: 'gram' },
  { code: 'mg', kind: 'mass', symbol: 'mg', labelFr: 'milligramme', labelEn: 'milligram' },
  { code: 'ug', kind: 'mass', symbol: 'µg', labelFr: 'microgramme', labelEn: 'microgram' },
  { code: 'L', kind: 'volume', symbol: 'L', labelFr: 'litre', labelEn: 'litre' },
  { code: 'mL', kind: 'volume', symbol: 'mL', labelFr: 'millilitre', labelEn: 'millilitre' },
  { code: 'm', kind: 'length', symbol: 'm', labelFr: 'mètre', labelEn: 'metre' },
  { code: 'cm', kind: 'length', symbol: 'cm', labelFr: 'centimètre', labelEn: 'centimetre' },
  { code: 'mm', kind: 'length', symbol: 'mm', labelFr: 'millimètre', labelEn: 'millimetre' },
  {
    code: 'Cel',
    kind: 'temperature',
    symbol: '°C',
    labelFr: 'degré Celsius',
    labelEn: 'degree Celsius',
  },
  {
    code: 'mm[Hg]',
    kind: 'pressure',
    symbol: 'mmHg',
    labelFr: 'millimètre de mercure',
    labelEn: 'millimetre of mercury',
  },
  { code: '/min', kind: 'rate', symbol: '/min', labelFr: 'par minute', labelEn: 'per minute' },
  { code: '%', kind: 'ratio', symbol: '%', labelFr: 'pourcentage', labelEn: 'percent' },
  {
    code: 'mmol/L',
    kind: 'concentration',
    symbol: 'mmol/L',
    labelFr: 'millimole par litre',
    labelEn: 'millimole per litre',
  },
  {
    code: 'umol/L',
    kind: 'concentration',
    symbol: 'µmol/L',
    labelFr: 'micromole par litre',
    labelEn: 'micromole per litre',
  },
  {
    code: 'mg/dL',
    kind: 'concentration',
    symbol: 'mg/dL',
    labelFr: 'milligramme par décilitre',
    labelEn: 'milligram per decilitre',
  },
  {
    code: 'g/dL',
    kind: 'concentration',
    symbol: 'g/dL',
    labelFr: 'gramme par décilitre',
    labelEn: 'gram per decilitre',
  },
  {
    code: 'g/L',
    kind: 'concentration',
    symbol: 'g/L',
    labelFr: 'gramme par litre',
    labelEn: 'gram per litre',
  },
  {
    code: '[iU]',
    kind: 'count',
    symbol: 'UI',
    labelFr: 'unité internationale',
    labelEn: 'international unit',
  },
  { code: 'min', kind: 'time', symbol: 'min', labelFr: 'minute', labelEn: 'minute' },
  { code: 'h', kind: 'time', symbol: 'h', labelFr: 'heure', labelEn: 'hour' },
  { code: 'd', kind: 'time', symbol: 'j', labelFr: 'jour', labelEn: 'day' },
];

/** Kinds of administrative division by level, for the DRC. */
export const ADMIN_AREA_KINDS: Record<number, readonly string[]> = {
  1: ['province'],
  2: ['territory', 'city'],
  3: ['sector', 'chiefdom', 'commune'],
  4: ['groupement', 'quarter'],
};

export const PROVINCES_SOURCE = 'Constitution de la RDC (2006), article 2 ; codes ISO 3166-2:CD';

/** The 26 provinces of the DRC; lower levels are imported from an official file. */
export const DRC_PROVINCES: readonly { code: string; name: string }[] = [
  { code: 'CD-KN', name: 'Kinshasa' },
  { code: 'CD-BC', name: 'Kongo-Central' },
  { code: 'CD-KG', name: 'Kwango' },
  { code: 'CD-KL', name: 'Kwilu' },
  { code: 'CD-MN', name: 'Mai-Ndombe' },
  { code: 'CD-KS', name: 'Kasaï' },
  { code: 'CD-KC', name: 'Kasaï-Central' },
  { code: 'CD-KE', name: 'Kasaï-Oriental' },
  { code: 'CD-LO', name: 'Lomami' },
  { code: 'CD-SA', name: 'Sankuru' },
  { code: 'CD-MA', name: 'Maniema' },
  { code: 'CD-SK', name: 'Sud-Kivu' },
  { code: 'CD-NK', name: 'Nord-Kivu' },
  { code: 'CD-IT', name: 'Ituri' },
  { code: 'CD-HU', name: 'Haut-Uélé' },
  { code: 'CD-BU', name: 'Bas-Uélé' },
  { code: 'CD-TO', name: 'Tshopo' },
  { code: 'CD-TU', name: 'Tshuapa' },
  { code: 'CD-MO', name: 'Mongala' },
  { code: 'CD-NU', name: 'Nord-Ubangi' },
  { code: 'CD-SU', name: 'Sud-Ubangi' },
  { code: 'CD-EQ', name: 'Équateur' },
  { code: 'CD-HL', name: 'Haut-Lomami' },
  { code: 'CD-LU', name: 'Lualaba' },
  { code: 'CD-HK', name: 'Haut-Katanga' },
  { code: 'CD-TA', name: 'Tanganyika' },
];
