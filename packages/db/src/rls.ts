import type pg from 'pg';

/**
 * Tables that carry a tenant_id but are infrastructure processed across all
 * structures by the worker. Anything else with a tenant_id gets forced RLS.
 */
export const RLS_EXEMPT_TABLES: ReadonlySet<string> = new Set(['job']);

const TENANT_EXPR = `nullif(current_setting('app.tenant_id', true), '')::uuid`;
const SCOPE_EXPR = `nullif(current_setting('app.scope', true), '')`;

export function rlsStatements(table: string): string[] {
  const t = `"${table}"`;
  return [
    `alter table ${t} enable row level security`,
    `alter table ${t} force row level security`,
    `drop policy if exists tenant_isolation on ${t}`,
    `create policy tenant_isolation on ${t} using (tenant_id = ${TENANT_EXPR}) with check (tenant_id = ${TENANT_EXPR})`,
    `drop policy if exists platform_scope on ${t}`,
    `create policy platform_scope on ${t} for select using (${SCOPE_EXPR} = 'platform')`,
  ];
}

export async function tenantTables(client: pg.ClientBase): Promise<string[]> {
  const { rows } = await client.query<{ table_name: string }>(
    `select c.table_name
       from information_schema.columns c
       join information_schema.tables t
         on t.table_schema = c.table_schema and t.table_name = c.table_name
      where c.table_schema = 'public' and c.column_name = 'tenant_id' and t.table_type = 'BASE TABLE'
      order by c.table_name`,
  );
  return rows.map((r) => r.table_name).filter((name) => !RLS_EXEMPT_TABLES.has(name));
}

/**
 * Idempotent: introspects every table that has a tenant_id column so that a new
 * business table can never be forgotten. Runs after each migration.
 */
export async function ensureRls(client: pg.ClientBase): Promise<string[]> {
  const tables = await tenantTables(client);
  for (const table of tables) {
    for (const statement of rlsStatements(table)) await client.query(statement);
  }
  return tables;
}

export type RlsStatus = { table: string; enabled: boolean; forced: boolean; policies: string[] };

export async function rlsStatus(client: pg.ClientBase): Promise<RlsStatus[]> {
  const tables = await tenantTables(client);
  const { rows } = await client.query<{
    relname: string;
    relrowsecurity: boolean;
    relforcerowsecurity: boolean;
    policies: string[] | null;
  }>(
    `select c.relname, c.relrowsecurity, c.relforcerowsecurity,
            array_agg(p.polname::text) filter (where p.polname is not null) as policies
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
       left join pg_policy p on p.polrelid = c.oid
      where c.relname = any($1)
      group by c.relname, c.relrowsecurity, c.relforcerowsecurity`,
    [tables],
  );
  return rows.map((r) => ({
    table: r.relname,
    enabled: r.relrowsecurity,
    forced: r.relforcerowsecurity,
    policies: r.policies ?? [],
  }));
}
