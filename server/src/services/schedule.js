// Turning a medication schedule into concrete doses.
//
// A medication says "08:00 and 20:00, every day". That is a wall clock
// instruction, and a wall clock is not a moment in time until you know where
// the clock is. 08:00 in Asia/Kolkata and 08:00 in Europe/London are five and a
// half hours apart, and on the two days a year a zone shifts, one of those wall
// times may not exist at all or may happen twice.
//
// So every conversion goes through the circle's IANA timezone, and the awkward
// cases are handled explicitly rather than left to whatever the runtime happens
// to do.

import { DateTime } from 'luxon';
import { Medication, Occurrence } from '../models/index.js';

/** How far ahead doses are materialised by default. */
export const DEFAULT_HORIZON_DAYS = 14;

/**
 * Every local date from `from` to `to` inclusive, as "YYYY-MM-DD".
 */
export function localDateRange(from, to) {
  const dates = [];
  let cursor = DateTime.fromISO(from);
  const end = DateTime.fromISO(to);
  if (!cursor.isValid || !end.isValid) {
    throw new Error(`invalid date range: ${from}..${to}`);
  }
  while (cursor <= end) {
    dates.push(cursor.toFormat('yyyy-MM-dd'));
    cursor = cursor.plus({ days: 1 });
  }
  return dates;
}

/**
 * Whether a medication is scheduled on a given local date.
 */
export function appliesOn(medication, localDate) {
  if (medication.active === false) return false;
  if (localDate < medication.startDate) return false;
  if (medication.endDate && localDate > medication.endDate) return false;

  const days = medication.daysOfWeek ?? [];
  if (days.length === 0) return true; // empty means every day

  // Luxon weekdays run 1 (Monday) to 7 (Sunday); the model uses 0 (Sunday) to
  // 6 (Saturday), matching JavaScript's Date.getDay.
  const weekday = DateTime.fromISO(localDate).weekday % 7;
  return days.includes(weekday);
}

/**
 * The UTC instant for a wall clock time on a local date in a timezone.
 *
 * Returns null when the wall time does not exist, which happens for an hour
 * once a year in zones that spring forward. Skipping the dose is the honest
 * outcome: inventing an instant would put a dose on the schedule at a time the
 * clock never showed, and silently shifting it by an hour would be worse, since
 * medication timing is the thing the app exists to get right.
 */
export function instantFor(localDate, timeOfDay, timezone) {
  const dt = DateTime.fromISO(`${localDate}T${timeOfDay}`, { zone: timezone });
  if (!dt.isValid) return null;

  // Luxon resolves a nonexistent local time by shifting forward rather than
  // failing, so the shift has to be detected by reading the wall clock back.
  if (dt.toFormat('HH:mm') !== timeOfDay) return null;

  return dt.toUTC().toJSDate();
}

/**
 * The doses a medication implies over a range of local dates.
 *
 * Pure: it touches no database, which is what makes the timezone behaviour
 * straightforward to test.
 */
export function plannedDoses(medication, timezone, fromDate, toDate) {
  const doses = [];
  const skipped = [];

  for (const localDate of localDateRange(fromDate, toDate)) {
    if (!appliesOn(medication, localDate)) continue;

    for (const timeOfDay of medication.timesOfDay) {
      const dueAt = instantFor(localDate, timeOfDay, timezone);
      if (!dueAt) {
        skipped.push({ localDate, timeOfDay, reason: 'local time does not exist in this timezone' });
        continue;
      }
      doses.push({ localDate, timeOfDay, dueAt });
    }
  }

  return { doses, skipped };
}

/**
 * Materialise a circle's doses for a window, and return what changed.
 *
 * Safe to call as often as you like. Each dose is upserted on
 * (medication, dueAt), which the unique index makes atomic, so concurrent calls
 * cannot produce the same dose twice. Fields that a human may have set —
 * status, who resolved it, the note — are written only on insert, so
 * regenerating never un-ticks a dose somebody already gave.
 */
export async function ensureOccurrences(circle, { horizonDays = DEFAULT_HORIZON_DAYS, now = new Date() } = {}) {
  const today = DateTime.fromJSDate(now, { zone: circle.timezone });
  const fromDate = today.toFormat('yyyy-MM-dd');
  const toDate = today.plus({ days: horizonDays }).toFormat('yyyy-MM-dd');

  const medications = await Medication.find({ circle: circle._id, active: true });

  const operations = [];
  const skipped = [];

  for (const medication of medications) {
    const planned = plannedDoses(medication, circle.timezone, fromDate, toDate);
    skipped.push(...planned.skipped.map((s) => ({ ...s, medication: medication.name })));

    for (const dose of planned.doses) {
      operations.push({
        updateOne: {
          filter: { medication: medication._id, dueAt: dose.dueAt },
          update: {
            $setOnInsert: {
              circle: circle._id,
              medication: medication._id,
              dueAt: dose.dueAt,
              localDate: dose.localDate,
              status: 'due',
              resolvedBy: null,
              resolvedAt: null,
              note: '',
            },
          },
          upsert: true,
        },
      });
    }
  }

  if (operations.length === 0) {
    return { created: 0, planned: 0, skipped };
  }

  // ordered:false so one duplicate-key race does not abandon the rest of the
  // batch. A duplicate here is expected, not exceptional: it means another
  // request materialised the same dose a moment earlier.
  const result = await Occurrence.bulkWrite(operations, { ordered: false });

  return {
    created: result.upsertedCount ?? 0,
    planned: operations.length,
    skipped,
  };
}

/**
 * A dose is overdue when its time has passed and nobody has said what happened.
 *
 * This is derived at read time rather than stored, so there is no background
 * job that can fall behind and no row whose status disagrees with the clock.
 */
export function isOverdue(occurrence, { now = new Date(), graceMinutes = 30 } = {}) {
  if (occurrence.status !== 'due') return false;
  return now.getTime() - new Date(occurrence.dueAt).getTime() > graceMinutes * 60 * 1000;
}
