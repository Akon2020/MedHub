import { v7, validate, version } from 'uuid';

export function uuidv7(): string {
  return v7();
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && validate(value);
}

export function isUuidV7(value: unknown): value is string {
  return isUuid(value) && version(value) === 7;
}
