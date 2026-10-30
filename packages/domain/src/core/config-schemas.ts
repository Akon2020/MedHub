import { z } from 'zod';
import { OFFLINE_TOKEN_DEFAULT_DAYS, OFFLINE_TOKEN_MAX_DAYS } from './license';

/**
 * Simple settings stored in `config_entry` (docs/06-configuration.md section 2).
 * Every key has a schema and a documented default; a structure only stores what
 * it changes. Values are read by the server and, once published, by the devices.
 */
export const CONFIG_DEFINITIONS = {
  'security.offline_token_days': {
    domain: 'security',
    schema: z.number().int().min(1).max(OFFLINE_TOKEN_MAX_DAYS),
    default: OFFLINE_TOKEN_DEFAULT_DAYS,
    unit: 'days',
  },
  'security.auto_lock_minutes': {
    domain: 'security',
    schema: z.number().int().min(1).max(60),
    default: 5,
    unit: 'minutes',
  },
  'security.pin_max_attempts': {
    domain: 'security',
    schema: z.number().int().min(3).max(20),
    default: 10,
    unit: 'attempts',
  },
  'security.step_up_minutes': {
    domain: 'security',
    schema: z.number().int().min(5).max(60),
    default: 15,
    unit: 'minutes',
  },
} as const;

export type ConfigKey = keyof typeof CONFIG_DEFINITIONS;
export type ConfigValues = { [K in ConfigKey]: z.infer<(typeof CONFIG_DEFINITIONS)[K]['schema']> };
export const CONFIG_KEYS = Object.keys(CONFIG_DEFINITIONS) as ConfigKey[];

export function isConfigKey(value: unknown): value is ConfigKey {
  return typeof value === 'string' && value in CONFIG_DEFINITIONS;
}

export function parseConfigValue<K extends ConfigKey>(key: K, value: unknown): ConfigValues[K] {
  return CONFIG_DEFINITIONS[key].schema.parse(value) as ConfigValues[K];
}

/** Published values over the defaults; an invalid stored value falls back to the default. */
export function resolveConfig(published: Partial<Record<string, unknown>>): ConfigValues {
  const out = {} as Record<ConfigKey, unknown>;
  for (const key of CONFIG_KEYS) {
    const parsed = CONFIG_DEFINITIONS[key].schema.safeParse(published[key]);
    out[key] = parsed.success ? parsed.data : CONFIG_DEFINITIONS[key].default;
  }
  return out as ConfigValues;
}

/** The part of the configuration a device needs offline. */
export type DeviceConfig = { autoLockMinutes: number; pinMaxAttempts: number };

export function deviceConfig(values: ConfigValues): DeviceConfig {
  return {
    autoLockMinutes: values['security.auto_lock_minutes'],
    pinMaxAttempts: values['security.pin_max_attempts'],
  };
}
