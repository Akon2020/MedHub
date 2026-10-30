import { describe, expect, it } from 'vitest';
import {
  canDeactivateSite,
  changedFields,
  departmentCreateSchema,
  siteCreateSchema,
  tenantProfileSchema,
} from './organization';
import { assessSignIn, deviceLabel, localHour } from './sign-in-risk';

const CHROME_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const CHROME_ANDROID =
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36';

describe('organization rules', () => {
  it('normalises a site code and refuses anything but three letters', () => {
    const base = { name: 'Site de Limete', address: {}, timezone: 'Africa/Kinshasa', phone: '' };
    expect(siteCreateSchema.parse({ ...base, code: 'lim' }).code).toBe('LIM');
    expect(siteCreateSchema.safeParse({ ...base, code: 'LI1' }).success).toBe(false);
    expect(siteCreateSchema.parse({ ...base, code: 'LIM' }).phone).toBeNull();
  });

  it('only accepts the department kinds of the data model', () => {
    const base = {
      siteId: '0190f5a0-0000-7000-8000-000000000001',
      code: 'cons',
      name: 'Consultations',
    };
    expect(departmentCreateSchema.parse({ ...base, kind: 'clinical' }).code).toBe('CONS');
    expect(departmentCreateSchema.safeParse({ ...base, kind: 'kitchen' }).success).toBe(false);
  });

  it('keeps the structure code and status out of the editable profile', () => {
    const parsed = tenantProfileSchema.parse({
      displayName: 'Clinique fictive',
      legalName: 'Clinique fictive SARL',
      defaultLocale: 'fr',
      defaultCurrency: 'CDF',
      timezone: 'Africa/Lubumbashi',
      contact: { phone: '+243 81 000 0000', email: '', address: { city: 'Lubumbashi' } },
      code: 'HOP-XXX-0001',
      status: 'active',
    });
    expect(parsed).not.toHaveProperty('code');
    expect(parsed).not.toHaveProperty('status');
    expect(parsed.contact.email).toBeNull();
  });

  it('always keeps one active site', () => {
    const sites = [
      { id: 'a', isActive: true },
      { id: 'b', isActive: false },
    ];
    expect(canDeactivateSite(sites, 'a')).toBe(false);
    expect(canDeactivateSite([...sites, { id: 'c', isActive: true }], 'a')).toBe(true);
  });

  it('lists only the fields that really change', () => {
    const before: { name: string; phone: string | null } = { name: 'A', phone: null };
    expect(changedFields(before, { name: 'A', phone: '+243' })).toEqual(['phone']);
  });
});

describe('sign-in risk', () => {
  const at = (iso: string) => new Date(iso);

  it('never flags the first sign-in of an account', () => {
    expect(
      assessSignIn(
        [],
        { at: at('2026-10-30T02:00:00Z'), userAgent: CHROME_ANDROID },
        'Africa/Kinshasa',
      ),
    ).toEqual([]);
  });

  it('flags a browser and system never seen for this user', () => {
    const history = [{ at: at('2026-10-29T08:00:00Z'), userAgent: CHROME_WINDOWS }];
    expect(
      assessSignIn(
        history,
        { at: at('2026-10-30T08:00:00Z'), userAgent: CHROME_WINDOWS },
        'Africa/Kinshasa',
      ),
    ).toEqual([]);
    expect(
      assessSignIn(
        history,
        { at: at('2026-10-30T08:00:00Z'), userAgent: CHROME_ANDROID },
        'Africa/Kinshasa',
      ),
    ).toEqual(['new_device']);
  });

  it('flags an hour far from every usual sign-in once the history is long enough', () => {
    const history = Array.from({ length: 12 }, (_, i) => ({
      at: at(`2026-10-${String(10 + i).padStart(2, '0')}T07:30:00Z`),
      userAgent: CHROME_WINDOWS,
    }));
    expect(
      assessSignIn(
        history,
        { at: at('2026-10-30T08:10:00Z'), userAgent: CHROME_WINDOWS },
        'Africa/Kinshasa',
      ),
    ).toEqual([]);
    expect(
      assessSignIn(
        history,
        { at: at('2026-10-30T01:00:00Z'), userAgent: CHROME_WINDOWS },
        'Africa/Kinshasa',
      ),
    ).toEqual(['unusual_hour']);
    expect(
      assessSignIn(
        history.slice(0, 5),
        { at: at('2026-10-30T01:00:00Z'), userAgent: CHROME_WINDOWS },
        'Africa/Kinshasa',
      ),
    ).toEqual([]);
  });

  it('reads hours in the structure time zone and labels devices', () => {
    expect(localHour(at('2026-10-30T23:30:00Z'), 'Africa/Kinshasa')).toBe(0);
    expect(localHour(at('2026-10-30T23:30:00Z'), 'Africa/Lubumbashi')).toBe(1);
    expect(deviceLabel(CHROME_ANDROID)).toBe('Chrome · Android');
    expect(deviceLabel(null)).toBe('');
  });
});
