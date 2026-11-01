import { describe, expect, it } from 'vitest';
import { compareTickets, formatTicketNumber, waitedMinutes } from './visits';

describe('queue tickets', () => {
  it('puts emergencies first, then priorities, then arrival time', () => {
    const tickets = [
      { id: '1', priority: 'normal', issuedAt: '2026-11-02T08:00:00.000Z' },
      { id: '2', priority: 'elderly', issuedAt: '2026-11-02T08:05:00.000Z' },
      { id: '3', priority: 'emergency', issuedAt: '2026-11-02T08:10:00.000Z' },
      { id: '4', priority: 'pregnant', issuedAt: '2026-11-02T08:01:00.000Z' },
      { id: '5', priority: 'normal', issuedAt: '2026-11-02T07:59:00.000Z' },
    ];
    expect([...tickets].sort(compareTickets).map((t) => t.id)).toEqual(['3', '4', '2', '5', '1']);
  });

  it('numbers tickets per queue and workstation, and counts the wait', () => {
    expect(formatTicketNumber('C', 'AB', 7)).toBe('C-AB-007');
    expect(waitedMinutes('2026-11-02T08:00:00.000Z', new Date('2026-11-02T08:42:30.000Z'))).toBe(
      42,
    );
  });
});
