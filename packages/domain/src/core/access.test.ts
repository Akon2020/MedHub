import { describe, expect, it } from 'vitest';
import { allowedSensitivities, sensitivityAllowed, userSensitivityMax } from './access';

const read = (conditions: Record<string, unknown> = {}) => ({ key: 'patient:read', conditions });
const mark = { key: 'patient:mark_sensitive', conditions: {} };

describe('access to sensitive records', () => {
  it('opens normal records only, unless the role marks sensitivity or says otherwise', () => {
    expect(userSensitivityMax([[read()]])).toBe('normal');
    expect(userSensitivityMax([[read(), mark]])).toBe('restricted');
    expect(userSensitivityMax([[read({ sensitivity_max: 'staff' }), mark]])).toBe('staff');
    // A role that does not read patients gives nothing, the best role wins.
    expect(userSensitivityMax([[mark], [read({ sensitivity_max: 'vip' })]])).toBe('vip');
  });

  it('compares levels, an unknown level being the most protected', () => {
    expect(sensitivityAllowed('staff', 'vip')).toBe(true);
    expect(sensitivityAllowed('restricted', 'vip')).toBe(false);
    expect(sensitivityAllowed('other', 'vip')).toBe(false);
    expect(allowedSensitivities('staff')).toEqual(['normal', 'staff']);
  });
});
