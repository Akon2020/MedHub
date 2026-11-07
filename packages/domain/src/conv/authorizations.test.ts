import { describe, expect, it } from 'vitest';
import {
  authorizationFor,
  guaranteeBalance,
  priorAuthorizationDecisionInput,
  type AuthorizationView,
} from './authorizations';

const SCAN = '0190a000-0000-7000-8000-000000000001';
const id = '0190a000-0000-7000-8000-0000000000aa';
const view = (over: Partial<AuthorizationView>): AuthorizationView => ({
  serviceItemId: SCAN,
  status: 'pending',
  authorizedAmount: null,
  validUntil: null,
  requestedAt: '2026-11-07T08:00:00.000Z',
  ...over,
});

describe('authorizationFor', () => {
  it('knows nothing for a line without service', () => {
    expect(authorizationFor([view({})], null, '2026-11-07').status).toBe('none');
  });

  it('uses an approval in force, even after a newer pending request', () => {
    const out = authorizationFor(
      [
        view({ status: 'approved', authorizedAmount: 12000, validUntil: '2026-11-30' }),
        view({ requestedAt: '2026-11-07T09:00:00.000Z' }),
      ],
      SCAN,
      '2026-11-10',
    );
    expect(out).toEqual({ status: 'approved', authorizedAmount: 12000 });
  });

  it('forgets an expired approval', () => {
    const out = authorizationFor(
      [view({ status: 'approved', authorizedAmount: 12000, validUntil: '2026-11-08' })],
      SCAN,
      '2026-11-09',
    );
    expect(out.status).toBe('none');
  });

  it('reports the last pending or rejected request', () => {
    expect(authorizationFor([view({})], SCAN, '2026-11-07').status).toBe('pending');
    expect(authorizationFor([view({ status: 'rejected' })], SCAN, '2026-11-07').status).toBe(
      'rejected',
    );
  });
});

describe('priorAuthorizationDecisionInput', () => {
  it('requires an amount and an end date to approve, a note to reject', () => {
    expect(priorAuthorizationDecisionInput.safeParse({ id, approve: true }).success).toBe(false);
    expect(
      priorAuthorizationDecisionInput.safeParse({
        id,
        approve: true,
        authorizedAmount: 12000,
        validUntil: '2026-12-31',
      }).success,
    ).toBe(true);
    expect(priorAuthorizationDecisionInput.safeParse({ id, approve: false }).success).toBe(false);
    expect(
      priorAuthorizationDecisionInput.safeParse({ id, approve: false, note: 'Hors contrat' })
        .success,
    ).toBe(true);
  });
});

describe('guaranteeBalance', () => {
  it('nets received and refunded amounts per worker', () => {
    const out = guaranteeBalance([
      { memberNumber: 'A-1', kind: 'receive', amount: 7500 },
      { memberNumber: 'A-2', kind: 'receive', amount: 7500 },
      { memberNumber: 'A-1', kind: 'refund', amount: 7500 },
    ]);
    expect(out).toEqual({ total: 7500, byMember: { 'A-1': 0, 'A-2': 7500 } });
  });
});
