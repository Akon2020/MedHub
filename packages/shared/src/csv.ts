export type CsvTable = { header: string[]; rows: { line: number; cells: string[] }[] };

/** The separator of a French Excel export is ";"; others use "," or a tab. */
function detectSeparator(firstLine: string): string {
  const counts = [';', ',', '\t'].map((s) => [s, firstLine.split(s).length - 1] as const);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0] && counts[0][1] > 0 ? counts[0][0] : ';';
}

/**
 * Small RFC 4180 reader: quoted fields, doubled quotes, line breaks inside
 * quotes, Excel byte order mark. Empty lines are skipped; line numbers are
 * those of the file, for the error report.
 */
export function parseCsv(text: string): CsvTable {
  const source = text.replace(/^\uFEFF/, '');
  const firstBreak = source.search(/\r?\n/);
  const separator = detectSeparator(firstBreak === -1 ? source : source.slice(0, firstBreak));
  const records: { line: number; cells: string[] }[] = [];
  let cells: string[] = [];
  let field = '';
  let quoted = false;
  let line = 1;
  let recordLine = 1;

  const endRecord = () => {
    cells.push(field);
    if (cells.some((c) => c.trim() !== '')) records.push({ line: recordLine, cells });
    cells = [];
    field = '';
  };

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        if (char === '\n') line += 1;
        field += char;
      }
    } else if (char === '"' && field === '') {
      quoted = true;
    } else if (char === separator) {
      cells.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i += 1;
      endRecord();
      line += 1;
      recordLine = line;
    } else {
      field += char;
    }
  }
  if (field !== '' || cells.length > 0) endRecord();

  const [head, ...rows] = records;
  return {
    header: (head?.cells ?? []).map((h) => h.trim().toLowerCase()),
    rows: rows.map((r) => ({ line: r.line, cells: r.cells.map((c) => c.trim()) })),
  };
}
