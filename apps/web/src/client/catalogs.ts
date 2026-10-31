import type { CatalogSnapshot } from '@medhub/domain';
import { loadCatalogs, saveCatalogs, type MedHubLocalDb } from '@medhub/local-db';
import { apiFetch } from './api';

/** The etag check is cheap but not free: at most once every ten minutes. */
export const CATALOG_CHECK_INTERVAL_MS = 600_000;

type CatalogsResponse = CatalogSnapshot | { unchanged: true; etag: string };

/**
 * Keeps the local copy of the read-only catalogs current. Returns the snapshot
 * when it changed, null otherwise (including on any network error: the
 * previous copy stays in use).
 */
export async function refreshCatalogs(
  db: MedHubLocalDb,
  now = Date.now(),
  force = false,
): Promise<CatalogSnapshot | null> {
  const stored = await loadCatalogs(db);
  if (!force && stored && now - stored.fetchedAt < CATALOG_CHECK_INTERVAL_MS) return null;
  try {
    const etag = stored ? `?etag=${encodeURIComponent(stored.snapshot.etag)}` : '';
    const response = await apiFetch<CatalogsResponse>(`/api/v1/reference/catalogs${etag}`);
    if ('unchanged' in response) {
      if (stored) await saveCatalogs(db, { ...stored, fetchedAt: now });
      return null;
    }
    await saveCatalogs(db, { snapshot: response, fetchedAt: now });
    return response;
  } catch {
    return null;
  }
}
