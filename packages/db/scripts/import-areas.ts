import { readFile } from 'node:fs/promises';
import { parseAdminAreas } from '@medhub/domain';
import { parseCsv } from '@medhub/shared';
import { sql } from 'drizzle-orm';
import { createDb } from '../src/client';
import { adminArea } from '../src/schema';
import { requireEnv } from './env';

/**
 * Platform import of administrative divisions below the provinces, from an
 * official CSV file (code;niveau;type;nom;code_parent). Simulation by default:
 * nothing is written unless --apply is given. Existing codes are updated, never
 * deleted.
 */
async function main(): Promise<void> {
  const file = process.argv.find((a) => a.endsWith('.csv'));
  const sourceArg = process.argv.find((a) => a.startsWith('--source='));
  const apply = process.argv.includes('--apply');
  if (!file || !sourceArg) {
    console.error(
      'Usage : pnpm db:import-areas <fichier.csv> --source="Document officiel, date" [--apply] [--test]',
    );
    process.exit(1);
  }
  const source = sourceArg.slice('--source='.length).trim();
  const url = process.argv.includes('--test')
    ? requireEnv('TEST_DATABASE_URL')
    : requireEnv('DATABASE_URL');
  const { pool, db } = createDb(url, 2);
  try {
    const existing = await db
      .select({ code: adminArea.code, level: adminArea.level })
      .from(adminArea);
    const known = new Map(existing.map((a) => [a.code, a.level]));
    const { rows, errors } = parseAdminAreas(parseCsv(await readFile(file, 'utf8')), known);
    for (const e of errors) console.error(`Ligne ${e.line}, ${e.field} : ${e.problem}`);
    console.warn(`${rows.length} lignes valides, ${errors.length} erreurs.`);
    if (!apply || errors.length > 0) {
      console.warn(
        apply
          ? 'Rien n’a été écrit : corrigez les erreurs.'
          : 'Simulation : ajoutez --apply pour écrire.',
      );
      if (errors.length > 0) process.exitCode = 1;
      return;
    }
    for (let i = 0; i < rows.length; i += 500) {
      await db
        .insert(adminArea)
        .values(rows.slice(i, i + 500).map((r) => ({ ...r, source })))
        .onConflictDoUpdate({
          target: adminArea.code,
          set: {
            name: sql`excluded.name`,
            kind: sql`excluded.kind`,
            level: sql`excluded.level`,
            parentCode: sql`excluded.parent_code`,
            source: sql`excluded.source`,
          },
        });
    }
    console.warn(`${rows.length} zones administratives importées.`);
  } finally {
    await pool.end();
  }
}

void main();
