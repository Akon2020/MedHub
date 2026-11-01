import { z } from 'zod';

/**
 * A user's favourite patients (docs/modules/pat.md, capability 12): each
 * toggle is a new row, the latest one per patient wins, and favourites enter
 * the synchronisation scope of the user's devices.
 */
export const patientFavoritePayload = z.object({
  patientId: z.uuid(),
  active: z.boolean(),
  at: z.iso.datetime(),
});
export type PatientFavoritePayload = z.infer<typeof patientFavoritePayload>;

export type FavoriteToggle = { id: string; patientId: string; active: boolean; at: string };

export function currentFavorites(toggles: readonly FavoriteToggle[]): Set<string> {
  const latest = new Map<string, FavoriteToggle>();
  for (const toggle of toggles) {
    const known = latest.get(toggle.patientId);
    if (!known || toggle.at > known.at || (toggle.at === known.at && toggle.id > known.id)) {
      latest.set(toggle.patientId, toggle);
    }
  }
  return new Set([...latest.values()].filter((t) => t.active).map((t) => t.patientId));
}
