import { describe, expect, it } from 'vitest';
import { passwordProblems } from './password-policy';
import { roleChanges, userCreateSchema } from './users';

const ROLE = '0190f1a2-0000-7000-8000-000000000001';

describe('password policy', () => {
  it('accepts a long passphrase without composition rules', () => {
    expect(passwordProblems('riviere lente sous la pluie')).toEqual([]);
  });

  it('rejects short, common and identity based passwords', () => {
    expect(passwordProblems('court')).toContain('too_short');
    expect(passwordProblems('Azerty2024!')).toContain('common');
    expect(passwordProblems('motdepasse123')).toContain('common');
    expect(passwordProblems('aaaaaaaaaaaa')).toContain('common');
    expect(passwordProblems('kasongo-2026-xy', { identity: ['Dieudonné Kasongo'] })).toEqual([
      'contains_identity',
    ]);
  });

  it('never lowers the documented minimum length', () => {
    expect(passwordProblems('neuf-lettr', { minLength: 6 })).toEqual([]);
    expect(passwordProblems('neuf-lett', { minLength: 6 })).toContain('too_short');
    expect(passwordProblems('douze-lettres', { minLength: 14 })).toContain('too_short');
  });
});

describe('user schemas', () => {
  it('normalizes the username and requires at least one role', () => {
    const parsed = userCreateSchema.parse({
      username: '  J.Mukendi ',
      displayName: 'Jeanne Mukendi',
      roleIds: [ROLE, ROLE],
    });
    expect(parsed.username).toBe('j.mukendi');
    expect(parsed.roleIds).toEqual([ROLE]);
    expect(
      userCreateSchema.safeParse({ username: 'abc', displayName: 'X Y', roleIds: [] }).success,
    ).toBe(false);
    expect(
      userCreateSchema.safeParse({ username: '1abc', displayName: 'X Y', roleIds: [ROLE] }).success,
    ).toBe(false);
  });

  it('computes role assignments to add and to end', () => {
    expect(roleChanges(['a', 'b'], ['b', 'c'])).toEqual({ added: ['c'], removed: ['a'] });
  });
});
