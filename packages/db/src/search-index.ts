import type pg from 'pg';

/**
 * Trigram index for the server patient search, only when the host provides
 * pg_trgm (docs/01-architecture.md, section 9). Without it the search falls
 * back to the normalized search_text column and the phonetic key.
 */
export async function ensureSearchIndexes(client: pg.ClientBase): Promise<boolean> {
  const { rows } = await client.query<{ ok: boolean }>(
    "select exists(select 1 from pg_extension where extname = 'pg_trgm') as ok",
  );
  if (!rows[0]?.ok) return false;
  await client.query(
    'create index if not exists patient_search_trgm_idx on patient using gin (search_text gin_trgm_ops)',
  );
  return true;
}
