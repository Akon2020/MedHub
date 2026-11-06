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
  'patient_field_history',
  'patient_favorite',
  'encounter',
  'queue_ticket',
  'triage',
  'appointment',
  'allergy',
  'medical_history',
  'problem',
  'clinical_event',
  'break_glass_event',
  'program_enrollment',
  'clinical_note',
  'diagnosis',
  'form_response',
  'prescription',
  'prescription_item',
  'medication_statement',
  'medication_reconciliation',
  'exchange_rate',
  'invoice',
  'invoice_line',
  'cash_session',
  'payment',
];
const NO_UPDATE = [
  'stock_movement',
  'op_log',
  'audit_log',
  'change_log',
  'data_access_log',
  'platform_audit_log',
  'security_event',
  'patient_field_history',
  'patient_favorite',
  'clinical_event',
  'medication_reconciliation',
  'exchange_rate',
  'payment',
];
const STATUS_ONLY_UPDATE = [
  'vital_sign',
  'triage',
  'clinical_note',
  'diagnosis',
  'form_response',
  'prescription',
  'prescription_item',
  'invoice_line',
];

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
  for (const table of ['config_entry', 'form_version']) {
    await client.query(`drop trigger if exists medhub_config_guard on "${table}"`);
    await client.query(
      `create trigger medhub_config_guard before update or delete on "${table}" for each row execute function medhub_config_guard()`,
    );
  }

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

  // An invoice keeps its identity; once finalized, only the move to voided is allowed.
  await client.query(`
    create or replace function medhub_invoice_guard() returns trigger language plpgsql as $$
    begin
      if new.tenant_id is distinct from old.tenant_id
         or new.patient_id is distinct from old.patient_id
         or new.encounter_id is distinct from old.encounter_id
         or new.number is distinct from old.number
         or new.currency is distinct from old.currency
         or new.opened_at is distinct from old.opened_at then
        raise exception 'MEDHUB_IMMUTABLE_ROW: invoice identity cannot change' using errcode = 'P0001';
      end if;
      if old.status <> 'open' and not (
        old.status = 'finalized' and new.status = 'voided'
        and new.finalized_at is not distinct from old.finalized_at
        and new.official_number is not distinct from old.official_number
        and new.supplementary_of is not distinct from old.supplementary_of
      ) then
        raise exception 'MEDHUB_IMMUTABLE_ROW: a finalized invoice cannot change' using errcode = 'P0001';
      end if;
      return new;
    end $$;
  `);
  // A closed cash session is final: no reopening, no change (docs/modules/fact.md section 4).
  await client.query(`
    create or replace function medhub_cash_session_guard() returns trigger language plpgsql as $$
    begin
      if old.status = 'closed' then
        raise exception 'MEDHUB_IMMUTABLE_ROW: a closed cash session cannot change' using errcode = 'P0001';
      end if;
      if new.opened_at is distinct from old.opened_at
         or new.opening_float is distinct from old.opening_float
         or new.device_id is distinct from old.device_id
         or new.created_by is distinct from old.created_by then
        raise exception 'MEDHUB_IMMUTABLE_ROW: the opening of a cash session cannot change' using errcode = 'P0001';
      end if;
      return new;
    end $$;
  `);
  await client.query('drop trigger if exists medhub_cash_session_guard on "cash_session"');
  await client.query(
    'create trigger medhub_cash_session_guard before update on "cash_session" for each row execute function medhub_cash_session_guard()',
  );
  await client.query('drop trigger if exists medhub_invoice_guard on "invoice"');
  await client.query(
    'create trigger medhub_invoice_guard before update on "invoice" for each row execute function medhub_invoice_guard()',
  );

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
