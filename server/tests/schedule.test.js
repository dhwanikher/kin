import { describe, expect, it } from 'vitest';

import { appliesOn, instantFor, isOverdue, localDateRange, plannedDoses } from '../src/services/schedule.js';

// These are the pure parts of scheduling. They touch no database, which is what
// makes the timezone behaviour worth testing properly rather than hoping.

describe('localDateRange', () => {
  it('is inclusive at both ends', () => {
    expect(localDateRange('2026-03-01', '2026-03-04')).toEqual([
      '2026-03-01',
      '2026-03-02',
      '2026-03-03',
      '2026-03-04',
    ]);
  });

  it('handles a single day', () => {
    expect(localDateRange('2026-03-01', '2026-03-01')).toEqual(['2026-03-01']);
  });

  it('crosses a month boundary', () => {
    expect(localDateRange('2026-02-27', '2026-03-01')).toEqual(['2026-02-27', '2026-02-28', '2026-03-01']);
  });

  it('crosses a leap day', () => {
    expect(localDateRange('2028-02-28', '2028-03-01')).toEqual(['2028-02-28', '2028-02-29', '2028-03-01']);
  });
});

describe('appliesOn', () => {
  const base = { startDate: '2026-01-01', endDate: null, daysOfWeek: [], active: true };

  it('runs every day when no weekdays are given', () => {
    expect(appliesOn(base, '2026-06-15')).toBe(true);
    expect(appliesOn(base, '2026-06-16')).toBe(true);
  });

  it('respects the start date', () => {
    expect(appliesOn({ ...base, startDate: '2026-06-10' }, '2026-06-09')).toBe(false);
    expect(appliesOn({ ...base, startDate: '2026-06-10' }, '2026-06-10')).toBe(true);
  });

  it('respects the end date', () => {
    const bounded = { ...base, endDate: '2026-06-10' };
    expect(appliesOn(bounded, '2026-06-10')).toBe(true);
    expect(appliesOn(bounded, '2026-06-11')).toBe(false);
  });

  it('filters by weekday, counting Sunday as zero', () => {
    // 2026-06-15 is a Monday, 2026-06-14 a Sunday.
    const mondaysOnly = { ...base, daysOfWeek: [1] };
    expect(appliesOn(mondaysOnly, '2026-06-15')).toBe(true);
    expect(appliesOn(mondaysOnly, '2026-06-14')).toBe(false);

    const sundaysOnly = { ...base, daysOfWeek: [0] };
    expect(appliesOn(sundaysOnly, '2026-06-14')).toBe(true);
    expect(appliesOn(sundaysOnly, '2026-06-15')).toBe(false);
  });

  it('ignores a stopped medication', () => {
    expect(appliesOn({ ...base, active: false }, '2026-06-15')).toBe(false);
  });
});

describe('instantFor', () => {
  it('reads a wall clock time in the circle timezone, not the server one', () => {
    // 08:00 in Kolkata is 02:30 UTC; the offset is +05:30.
    const instant = instantFor('2026-06-15', '08:00', 'Asia/Kolkata');
    expect(instant.toISOString()).toBe('2026-06-15T02:30:00.000Z');
  });

  it('gives different instants for the same wall clock in different zones', () => {
    const kolkata = instantFor('2026-06-15', '08:00', 'Asia/Kolkata');
    const london = instantFor('2026-06-15', '08:00', 'Europe/London');
    expect(kolkata.toISOString()).not.toBe(london.toISOString());
  });

  it('follows a daylight saving shift rather than a fixed offset', () => {
    // London is UTC+0 in January and UTC+1 in July. A fixed offset would make
    // one of these an hour wrong, which for a medication is a real error.
    expect(instantFor('2026-01-15', '08:00', 'Europe/London').toISOString()).toBe('2026-01-15T08:00:00.000Z');
    expect(instantFor('2026-07-15', '08:00', 'Europe/London').toISOString()).toBe('2026-07-15T07:00:00.000Z');
  });

  it('returns null for a wall clock time that does not exist', () => {
    // London springs forward at 01:00 on 2026-03-29, so 01:30 never happens.
    // Inventing an instant would schedule a dose at a time the clock never
    // showed; shifting it silently by an hour would be worse.
    expect(instantFor('2026-03-29', '01:30', 'Europe/London')).toBeNull();
  });

  it('still resolves times either side of the gap', () => {
    expect(instantFor('2026-03-29', '00:30', 'Europe/London')).not.toBeNull();
    expect(instantFor('2026-03-29', '02:30', 'Europe/London')).not.toBeNull();
  });
});

describe('plannedDoses', () => {
  const medication = {
    timesOfDay: ['08:00', '20:00'],
    daysOfWeek: [],
    startDate: '2026-06-01',
    endDate: null,
    active: true,
  };

  it('produces one dose per time per day', () => {
    const { doses } = plannedDoses(medication, 'Asia/Kolkata', '2026-06-15', '2026-06-17');
    expect(doses).toHaveLength(6);
  });

  it('orders doses within a day and keeps the local date', () => {
    const { doses } = plannedDoses(medication, 'Asia/Kolkata', '2026-06-15', '2026-06-15');
    expect(doses.map((d) => d.timeOfDay)).toEqual(['08:00', '20:00']);
    expect(doses.every((d) => d.localDate === '2026-06-15')).toBe(true);
  });

  it('reports the doses it had to skip instead of dropping them silently', () => {
    // startDate has to precede the date under test, or appliesOn excludes the
    // day before the timezone logic is ever reached — which is how the first
    // version of this test passed for the wrong reason.
    const overnight = { ...medication, timesOfDay: ['01:30'], startDate: '2026-01-01' };
    const { doses, skipped } = plannedDoses(overnight, 'Europe/London', '2026-03-29', '2026-03-29');

    expect(doses).toHaveLength(0);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toMatchObject({ localDate: '2026-03-29', timeOfDay: '01:30' });
  });

  it('honours the weekday filter', () => {
    const weekdays = { ...medication, timesOfDay: ['08:00'], daysOfWeek: [1, 2, 3, 4, 5] };
    // 2026-06-15 Mon .. 2026-06-21 Sun; five weekdays.
    const { doses } = plannedDoses(weekdays, 'Asia/Kolkata', '2026-06-15', '2026-06-21');
    expect(doses).toHaveLength(5);
  });
});

describe('isOverdue', () => {
  const now = new Date('2026-06-15T12:00:00.000Z');

  it('is false for a dose that has been dealt with', () => {
    const given = { status: 'given', dueAt: new Date('2026-06-15T06:00:00.000Z') };
    expect(isOverdue(given, { now })).toBe(false);
  });

  it('is false inside the grace period', () => {
    const recent = { status: 'due', dueAt: new Date('2026-06-15T11:45:00.000Z') };
    expect(isOverdue(recent, { now, graceMinutes: 30 })).toBe(false);
  });

  it('is true once the grace period has passed', () => {
    const stale = { status: 'due', dueAt: new Date('2026-06-15T11:00:00.000Z') };
    expect(isOverdue(stale, { now, graceMinutes: 30 })).toBe(true);
  });

  it('is false for a dose that is not due yet', () => {
    const future = { status: 'due', dueAt: new Date('2026-06-15T20:00:00.000Z') };
    expect(isOverdue(future, { now })).toBe(false);
  });
});
