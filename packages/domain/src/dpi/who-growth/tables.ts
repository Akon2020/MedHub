import data from './who-lms.json';
import type { GrowthTables } from './engine';

/**
 * Official WHO LMS tables (source, file addresses and download date in the
 * JSON itself). Imported on demand so that the tables stay out of the
 * application shell.
 */
export const WHO_GROWTH_TABLES = data.tables as unknown as GrowthTables;
export const WHO_GROWTH_SOURCE = data.source;
