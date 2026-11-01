import 'server-only';
import { schema, type Tx, withTenant } from '@medhub/db';
import { allowedSensitivities, parsePatientQuery } from '@medhub/domain';
import { AppError } from '@medhub/shared';
import { and, asc, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { database } from '../../platform/db';
import { env } from '../../platform/env';
import {
  loadPermissions,
  loadSensitivityMax,
  requirePermission,
  requireSensitivity,
} from '../../platform/permissions';
import type { RequestContext } from '../../platform/tenant';
import { patientBundles, patientState, pinPatient } from '../sync';

export const SEARCH_PAGE_SIZE = 20;

export type PatientHit = {
  id: string;
  mrn: string;
  name: string;
  sex: string;
  birthDate: string | null;
  birthDateEstimated: boolean;
  phone: string | null;
  place: string | null;
};

let trigramAvailable: boolean | null = null;

async function hasTrigram(tx: Tx): Promise<boolean> {
  if (env().MEDHUB_SEARCH_TRIGRAM === 'off') return false;
  if (trigramAvailable === null) {
    const rows = await tx.execute<{ ok: boolean }>(
      sql`select exists(select 1 from pg_extension where extname = 'pg_trgm') as ok`,
    );
    trigramAvailable = rows.rows[0]?.ok === true;
  }
  return trigramAvailable;
}

/**
 * Server search, also for patients outside the device's scope (docs/modules/pat.md,
 * capability 6): name with trigrams when pg_trgm exists, otherwise every word
 * in the normalized text or the phonetic key; phone, record number and birth
 * year narrow the result. Merged records are never returned.
 */
export async function searchPatients(
  ctx: RequestContext,
  input: { q: string; cursor: number },
): Promise<{ hits: PatientHit[]; next: number | null }> {
  const query = parsePatientQuery(input.q);
  if (!query.text && !query.phoneTail && !query.mrn && !query.cardToken) {
    return { hits: [], next: null };
  }
  return withTenant(database().db, { tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    requirePermission(await loadPermissions(tx, ctx.userId), 'patient:read');
    const p = schema.patient;
    // A record above the user's level is not even shown as a hit.
    const levels = allowedSensitivities(await loadSensitivityMax(tx, ctx.userId));
    const where: SQL[] = [inArray(p.sensitivity, levels)];
    let rank: SQL | null = null;
    if (query.cardToken) where.push(sql`${p.cardToken} = ${query.cardToken}`);
    if (query.mrn) {
      where.push(
        sql`(upper(${p.mrn}) = ${query.mrn} or upper(coalesce(${p.officialMrn}, '')) = ${query.mrn})`,
      );
    }
    if (query.phoneTail) {
      where.push(
        sql`right(regexp_replace(coalesce(${p.phone}, ''), '[^0-9]', '', 'g'), 9) = ${query.phoneTail}`,
      );
    }
    if (query.text) {
      const firstKey = query.phoneticKey.split(' ')[0] ?? '';
      if (await hasTrigram(tx)) {
        where.push(
          sql`(word_similarity(${query.text}, ${p.searchText}) > 0.45 or ${p.phoneticKey} like ${`${firstKey}%`})`,
        );
        rank = sql`word_similarity(${query.text}, ${p.searchText})`;
      } else {
        const words = query.text.split(' ').filter(Boolean);
        where.push(
          sql`(${sql.join(
            words.map((w) => sql`${p.searchText} like ${`%${w}%`}`),
            sql` and `,
          )} or ${p.phoneticKey} like ${`${firstKey}%`})`,
        );
      }
    }
    if (query.year !== null) {
      where.push(sql`${p.birthDate} between ${`${query.year}-01-01`} and ${`${query.year}-12-31`}`);
    }
    const rows = await tx
      .select()
      .from(p)
      .where(and(isNull(p.mergedIntoId), isNull(p.deletedAt), ...where))
      .orderBy(...(rank ? [sql`${rank} desc`] : []), asc(p.familyName), asc(p.id))
      .limit(SEARCH_PAGE_SIZE + 1)
      .offset(input.cursor);
    return {
      hits: rows.slice(0, SEARCH_PAGE_SIZE).map((r) => {
        const address = r.address ?? {};
        return {
          id: r.id,
          mrn: r.mrn,
          name: [r.familyName, r.middleName, r.givenName].filter(Boolean).join(' '),
          sex: r.sex,
          birthDate: r.birthDate,
          birthDateEstimated: r.birthDateEstimated,
          phone: r.phone,
          place: [address.commune, address.city].filter(Boolean).join(', ') || null,
        };
      }),
      next: rows.length > SEARCH_PAGE_SIZE ? input.cursor + SEARCH_PAGE_SIZE : null,
    };
  });
}

/**
 * A patient found on the server but absent from the device: its current state,
 * stored locally like a pulled change, so the record opens offline afterwards.
 */
export async function fetchPatient(
  ctx: RequestContext,
  id: string,
): Promise<{
  id: string;
  version: number;
  data: Record<string, unknown>;
  rows: { entity: string; entityId: string; version: number; data: Record<string, unknown> }[];
}> {
  return withTenant(database().db, { tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    requirePermission(await loadPermissions(tx, ctx.userId), 'patient:read');
    const state = await patientState(tx, id);
    if (!state) throw new AppError('NOT_FOUND', 404);
    requireSensitivity(state.data.sensitivity, await loadSensitivityMax(tx, ctx.userId));
    // Opened on a device, the patient stays in that device's scope.
    if (ctx.deviceId) await pinPatient(tx, { tenantId: ctx.tenantId, deviceId: ctx.deviceId }, id);
    const rows = (await patientBundles(tx, [id], ctx.userId))
      .filter((r) => r.entity !== 'patient')
      .map(({ entity, state: row }) => ({
        entity,
        entityId: row.id,
        version: row.version,
        data: row.data,
      }));
    return { id: state.id, version: state.version, data: state.data, rows };
  });
}
