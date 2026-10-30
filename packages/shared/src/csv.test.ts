import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv';
import { DRC_PROVINCES } from './reference';

describe('csv reader', () => {
  it('reads a French Excel export with quotes, BOM and blank lines', () => {
    const table = parseCsv(
      '\uFEFFCode;Libellé;Ordre\r\nTAXI;"Taxi; moto";1\r\n\r\nPIED;"À ""pied""";2\r\n',
    );
    expect(table.header).toEqual(['code', 'libellé', 'ordre']);
    expect(table.rows).toEqual([
      { line: 2, cells: ['TAXI', 'Taxi; moto', '1'] },
      { line: 4, cells: ['PIED', 'À "pied"', '2'] },
    ]);
  });

  it('detects commas and keeps line numbers across quoted line breaks', () => {
    const table = parseCsv('code,label\nA,"deux\nlignes"\nB,simple');
    expect(table.rows.map((r) => [r.line, r.cells[0]])).toEqual([
      [2, 'A'],
      [4, 'B'],
    ]);
  });
});

describe('reference data', () => {
  it('lists the 26 provinces once each', () => {
    expect(DRC_PROVINCES).toHaveLength(26);
    expect(new Set(DRC_PROVINCES.map((p) => p.code)).size).toBe(26);
  });
});
