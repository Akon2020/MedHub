import { parseCsv } from '@medhub/shared';
import { describe, expect, it } from 'vitest';
import { parseAdminAreas, parseChoiceItems } from './reference';

describe('pick list import', () => {
  it('accepts French headers, fills the order and reports every bad line', () => {
    const { items, errors } = parseChoiceItems(
      parseCsv(
        'Code;Libellé;Libellé EN\nTAXI;Taxi;Taxi\nMOTO;Moto-taxi;\n;Sans code;\nTAXI;Doublon;',
      ),
    );
    expect(items).toEqual([
      { code: 'TAXI', labelFr: 'Taxi', labelEn: 'Taxi', sortOrder: 10, isActive: true },
      { code: 'MOTO', labelFr: 'Moto-taxi', labelEn: null, sortOrder: 20, isActive: true },
    ]);
    expect(errors).toEqual([
      { line: 4, field: 'code', problem: 'invalid' },
      { line: 5, field: 'code', problem: 'duplicate' },
    ]);
  });

  it('refuses a file without the required columns', () => {
    expect(parseChoiceItems(parseCsv('nom;valeur\nA;B')).errors).toEqual([
      { line: 1, field: 'code', problem: 'missing_column' },
      { line: 1, field: 'libelle', problem: 'missing_column' },
    ]);
  });
});

describe('administrative areas import', () => {
  it('requires a known parent exactly one level above', () => {
    const known = new Map([['CD-KN', 1]]);
    const { rows, errors } = parseAdminAreas(
      parseCsv(
        [
          'code;niveau;type;nom;code_parent',
          'KN-CITY;2;city;Ville de Kinshasa;CD-KN',
          'KN-GOMBE;3;commune;Gombe;KN-CITY',
          'XX-1;3;commune;Orpheline;INCONNU',
          'XX-2;3;commune;Mauvais niveau;CD-KN',
          'XX-3;2;village;Type inconnu;CD-KN',
        ].join('\n'),
      ),
      known,
    );
    expect(rows.map((r) => r.code)).toEqual(['KN-CITY', 'KN-GOMBE']);
    expect(errors).toEqual([
      { line: 4, field: 'code_parent', problem: 'unknown' },
      { line: 5, field: 'code_parent', problem: 'wrong_level' },
      { line: 6, field: 'type', problem: 'invalid' },
    ]);
  });
});
