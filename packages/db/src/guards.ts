import type pg from 'pg';

/**
 * Defence in depth for the append-only rules: the database itself refuses a
 * DELETE on clinical, ledger and log tables, and an UPDATE on fully immutable
 * ones. Clinical append-only rows may only change their supersession metadata.
 */
const NO_DELETE = [
  'vital_sign',
  'stock_movement',
  'op_log',
  'audit_log',
  'change_log',
  'data_access_log',
  'platform_audit_log',
  'security_event',
  'patient',
];
const NO_UPDATE = [
  'stock_movement',
  'op_log',
  'audit_log',
  'change_log',
  'data_access_log',
  'platform_audit_log',
  'security_event',
];
const STATUS_ONLY_UPDATE = ['vital_sign'];

export async function ensureGuards(client: pg.ClientBase): Promise<void> {
  // Configuration: drafts are free; a published or archived version may only
  // change its status (published to archived), never its value.
  await client.query(`
    create or replace function medhub_config_guard() returns trigger language plpgsql as $$
    begin
      if tg_op = 'DELETE' then
        if old.status <> 'draft' then
          raise exception 'MEDHUB_IMMUTABLE_ROW: published configuration cannot be deleted'
            using errcode = 'P0001';
        end if;
        return old;
      end if;
      if old.status <> 'draft' and (
        (to_jsonb(new) - array['status','updated_at']) is distinct from
        (to_jsonb(old) - array['status','updated_at'])
        or not (old.status = 'published' and new.status = 'archived')
      ) then
        raise exception 'MEDHUB_IMMUTABLE_ROW: published configuration cannot change'
          using errcode = 'P0001';
      end if;
      return new;
    end $$;
  `);
  await client.query('drop trigger if exists medhub_config_guard on "config_entry"');
  await client.query(
    'create trigger medhub_config_guard before update or delete on "config_entry" for each row execute function medhub_config_guard()',
  );

  await client.query(`
    create or replace function medhub_forbid_change() returns trigger language plpgsql as $$
    begin
      raise exception 'MEDHUB_IMMUTABLE_ROW: % on % is forbidden', tg_op, tg_table_name
        using errcode = 'P0001';
    end $$;
  `);
  await client.query(`
    create or replace function medhub_status_only_update() returns trigger language plpgsql as $$
    begin
      if (to_jsonb(new) - array['status','version','op_id','hlc','device_id'])
         is distinct from (to_jsonb(old) - array['status','version','op_id','hlc','device_id']) then
        raise exception 'MEDHUB_APPEND_ONLY: only supersession metadata may change on %', tg_table_name
          using errcode = 'P0001';
      end if;
      return new;
    end $$;
  `);

  for (const table of NO_DELETE) {
    await client.query(`drop trigger if exists medhub_no_delete on "${table}"`);
    await client.query(
      `create trigger medhub_no_delete before delete on "${table}" for each row execute function medhub_forbid_change()`,
    );
  }
  for (const table of NO_UPDATE) {
    await client.query(`drop trigger if exists medhub_no_update on "${table}"`);
    await client.query(
      `create trigger medhub_no_update before update on "${table}" for each row execute function medhub_forbid_change()`,
    );
  }
  for (const table of STATUS_ONLY_UPDATE) {
    await client.query(`drop trigger if exists medhub_status_only on "${table}"`);
    await client.query(
      `create trigger medhub_status_only before update on "${table}" for each row execute function medhub_status_only_update()`,
    );
  }
}
