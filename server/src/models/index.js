// The whole domain in one place, because it is small and reads better together
// than split across six files you have to hold in your head at once.
//
// The shape of it: a Circle is one person being cared for. Several Users belong
// to a Circle through a Membership that carries their role. A Medication is a
// recurring instruction ("one tablet at 08:00 and 20:00"). An Occurrence is one
// concrete instance of that instruction on one day — the thing somebody
// actually ticks off.
//
// Splitting Medication from Occurrence is the decision everything else rests
// on. A schedule alone cannot record that Tuesday's evening dose was skipped
// because he was asleep, or that Priya gave it at 20:40 rather than 20:00.
// Those facts belong to the individual dose, so the individual dose has to
// exist as a row.

import mongoose from 'mongoose';

const { Schema, model } = mongoose;

export const ROLES = ['admin', 'caregiver', 'viewer'];
export const OCCURRENCE_STATUS = ['due', 'given', 'skipped', 'missed'];

/* -------------------------------------------------------------------------- */

const userSchema = new Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    name: { type: String, required: true, trim: true },
    passwordHash: { type: String, required: true },
  },
  { timestamps: true }
);

// The hash must never reach a response body, so it is stripped centrally rather
// than remembered at each of the places a user gets serialised.
userSchema.set('toJSON', {
  transform(_doc, ret) {
    delete ret.passwordHash;
    delete ret.__v;
    return ret;
  },
});

/* -------------------------------------------------------------------------- */

const circleSchema = new Schema(
  {
    // What the family calls this circle, e.g. "Dad" or "Nani".
    name: { type: String, required: true, trim: true },
    // An IANA zone, e.g. "Asia/Kolkata". Every "08:00" in a schedule is a wall
    // clock time in *this* zone; storing it here is what lets the server turn
    // a schedule into real instants without guessing.
    timezone: { type: String, required: true, default: 'Asia/Kolkata' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

/* -------------------------------------------------------------------------- */

const membershipSchema = new Schema(
  {
    circle: { type: Schema.Types.ObjectId, ref: 'Circle', required: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ROLES, required: true, default: 'caregiver' },
  },
  { timestamps: true }
);

// One membership per person per circle. Without this, inviting the same person
// twice silently doubles their access and makes role changes ambiguous.
membershipSchema.index({ circle: 1, user: 1 }, { unique: true });

/* -------------------------------------------------------------------------- */

const medicationSchema = new Schema(
  {
    circle: { type: Schema.Types.ObjectId, ref: 'Circle', required: true },
    name: { type: String, required: true, trim: true },
    // Free text on purpose: "1 tablet", "5ml", "half a tablet with food". Real
    // prescriptions do not fit a number and a unit, and forcing them to would
    // make the app lie about what the doctor wrote.
    dose: { type: String, required: true, trim: true },
    instructions: { type: String, trim: true, default: '' },

    // Wall clock times in the circle's timezone, as "HH:mm", sorted.
    timesOfDay: {
      type: [String],
      required: true,
      validate: {
        validator: (times) =>
          times.length > 0 && times.every((t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t)),
        message: 'timesOfDay must be one or more "HH:mm" values',
      },
    },
    // 0 = Sunday. Empty means every day, which is the common case.
    daysOfWeek: {
      type: [Number],
      default: [],
      validate: {
        validator: (days) => days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6),
        message: 'daysOfWeek must be integers 0-6',
      },
    },

    // Local dates "YYYY-MM-DD". endDate null means "ongoing".
    startDate: { type: String, required: true },
    endDate: { type: String, default: null },

    active: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

medicationSchema.index({ circle: 1, active: 1 });

/* -------------------------------------------------------------------------- */

const occurrenceSchema = new Schema(
  {
    circle: { type: Schema.Types.ObjectId, ref: 'Circle', required: true },
    medication: { type: Schema.Types.ObjectId, ref: 'Medication', required: true },

    // The real instant this dose is due, derived from the medication's wall
    // clock time and the circle's timezone.
    dueAt: { type: Date, required: true },
    // The same moment as a local calendar date, denormalised so "show me
    // today" is an index hit rather than a timezone calculation per row.
    localDate: { type: String, required: true },

    status: { type: String, enum: OCCURRENCE_STATUS, required: true, default: 'due' },
    resolvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    resolvedAt: { type: Date, default: null },
    note: { type: String, trim: true, default: '' },

    // When an overdue reminder was sent for this dose. Null means none yet.
    // Claiming this field is what makes a reminder exactly-once even if two
    // sweeps overlap; see services/reminders.js.
    remindedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// The safety property of the whole application.
//
// A dose is uniquely identified by its medication and the instant it is due, so
// the database physically cannot hold the same dose twice. Schedule generation
// is therefore free to run as often as it likes — on every request, on a timer,
// after an edit — and can never produce a duplicate that two people could each
// tick off believing they were the only one.
occurrenceSchema.index({ medication: 1, dueAt: 1 }, { unique: true });

// The query the main screen makes, every time it loads.
occurrenceSchema.index({ circle: 1, localDate: 1, dueAt: 1 });

// The query the reminder sweep makes, every minute: unresolved doses that are
// past due and have not been reminded about.
occurrenceSchema.index({ status: 1, remindedAt: 1, dueAt: 1 });

/* -------------------------------------------------------------------------- */

const pushSubscriptionSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    // The push service URL the browser gave us. Unique because re-subscribing
    // on the same browser returns the same endpoint, and storing it twice would
    // send every notification twice to one device.
    endpoint: { type: String, required: true, unique: true },
    keys: {
      p256dh: { type: String, required: true },
      auth: { type: String, required: true },
    },
    // Set aside for diagnostics when a subscription starts failing.
    userAgent: { type: String, default: '' },
  },
  { timestamps: true }
);

pushSubscriptionSchema.index({ user: 1 });

/* -------------------------------------------------------------------------- */

export const User = model('User', userSchema);
export const PushSubscription = model('PushSubscription', pushSubscriptionSchema);
export const Circle = model('Circle', circleSchema);
export const Membership = model('Membership', membershipSchema);
export const Medication = model('Medication', medicationSchema);
export const Occurrence = model('Occurrence', occurrenceSchema);
