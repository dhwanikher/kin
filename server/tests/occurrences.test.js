import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';

import { addMedication, api, createCircle, signUp, useTestDatabase } from './helpers.js';
import { Occurrence } from '../src/models/index.js';
import { ensureOccurrences } from '../src/services/schedule.js';
import { Circle } from '../src/models/index.js';

let teardown;
const app = api();

beforeAll(async () => {
  teardown = await useTestDatabase();
});
afterAll(async () => {
  await teardown();
});

const today = () => DateTime.now().setZone('Asia/Kolkata').toFormat('yyyy-MM-dd');

describe('the day view', () => {
  it('materialises doses on first read, so a quiet circle still has a schedule', async () => {
    const user = await signUp(app);
    const circle = await createCircle(app, user);
    await addMedication(app, user, circle.id ?? circle._id, { timesOfDay: ['08:00', '20:00'] });

    const res = await user
      .auth(request(app).get(`/api/circles/${circle.id ?? circle._id}/occurrences`))
      .expect(200);

    expect(res.body.occurrences).toHaveLength(2);
    expect(res.body.occurrences.map((o) => o.status)).toEqual(['due', 'due']);
    expect(res.body.timezone).toBe('Asia/Kolkata');
  });

  it('returns doses in the order they are due', async () => {
    const user = await signUp(app);
    const circle = await createCircle(app, user);
    await addMedication(app, user, circle.id ?? circle._id, { timesOfDay: ['20:00', '08:00', '14:00'] });

    const res = await user
      .auth(request(app).get(`/api/circles/${circle.id ?? circle._id}/occurrences`))
      .expect(200);

    const times = res.body.occurrences.map((o) => DateTime.fromISO(o.dueAt).toMillis());
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });
});

describe('recording what happened to a dose', () => {
  it('records who did it and when', async () => {
    const user = await signUp(app, { name: 'Priya' });
    const circle = await createCircle(app, user);
    const circleId = circle.id ?? circle._id;
    await addMedication(app, user, circleId, { timesOfDay: ['08:00'] });

    const list = await user.auth(request(app).get(`/api/circles/${circleId}/occurrences`)).expect(200);
    const dose = list.body.occurrences[0];

    const res = await user
      .auth(request(app).post(`/api/circles/${circleId}/occurrences/${dose._id}/resolve`))
      .send({ status: 'given', note: 'with breakfast' })
      .expect(200);

    expect(res.body.occurrence.status).toBe('given');
    expect(res.body.occurrence.resolvedBy.name).toBe('Priya');
    expect(res.body.occurrence.note).toBe('with breakfast');
    expect(res.body.occurrence.resolvedAt).toBeTruthy();
  });

  it('rejects a status it does not understand', async () => {
    const user = await signUp(app);
    const circle = await createCircle(app, user);
    const circleId = circle.id ?? circle._id;
    await addMedication(app, user, circleId, { timesOfDay: ['08:00'] });

    const list = await user.auth(request(app).get(`/api/circles/${circleId}/occurrences`)).expect(200);
    const dose = list.body.occurrences[0];

    await user
      .auth(request(app).post(`/api/circles/${circleId}/occurrences/${dose._id}/resolve`))
      .send({ status: 'probably-gave-it' })
      .expect(400);
  });
});

/**
 * The reason this application exists.
 *
 * Two people in the same house, both holding a phone, both about to give the
 * same tablet. Exactly one of them must win, and the other has to be told who
 * beat them and what they recorded — not quietly allowed to overwrite it.
 */
describe('two people reaching for the same dose', () => {
  it('lets exactly one of them record it, and tells the other who got there first', async () => {
    const priya = await signUp(app, { name: 'Priya' });
    const circle = await createCircle(app, priya);
    const circleId = circle.id ?? circle._id;

    const arjun = await signUp(app, { name: 'Arjun' });
    await priya
      .auth(request(app).post(`/api/circles/${circleId}/members`))
      .send({ email: arjun.email, role: 'caregiver' })
      .expect(201);

    await addMedication(app, priya, circleId, { timesOfDay: ['08:00'] });
    const list = await priya.auth(request(app).get(`/api/circles/${circleId}/occurrences`)).expect(200);
    const dose = list.body.occurrences[0];

    // Fired together, deliberately. A read-then-write implementation passes the
    // check in both requests and writes twice; only a conditional update makes
    // one of them fail.
    const [a, b] = await Promise.all([
      priya
        .auth(request(app).post(`/api/circles/${circleId}/occurrences/${dose._id}/resolve`))
        .send({ status: 'given', note: 'from Priya' }),
      arjun
        .auth(request(app).post(`/api/circles/${circleId}/occurrences/${dose._id}/resolve`))
        .send({ status: 'given', note: 'from Arjun' }),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);

    const winner = a.status === 200 ? a : b;
    const loser = a.status === 200 ? b : a;

    // The loser is told who beat them, which is the thing they actually need.
    expect(loser.body.error).toMatch(/already marked this as given/i);
    expect(loser.body.error).toMatch(/Priya|Arjun/);

    // And the database holds exactly one version of events.
    const stored = await Occurrence.findById(dose._id).populate('resolvedBy', 'name');
    expect(stored.status).toBe('given');
    expect(stored.note).toBe(winner.body.occurrence.note);
    expect(stored.resolvedBy.name).toBe(winner.body.occurrence.resolvedBy.name);
  });

  it('holds up when five people all tap at once', async () => {
    const owner = await signUp(app, { name: 'Owner' });
    const circle = await createCircle(app, owner);
    const circleId = circle.id ?? circle._id;

    const others = [];
    for (let i = 0; i < 4; i++) {
      const person = await signUp(app, { name: `Helper ${i}` });
      await owner
        .auth(request(app).post(`/api/circles/${circleId}/members`))
        .send({ email: person.email, role: 'caregiver' })
        .expect(201);
      others.push(person);
    }

    await addMedication(app, owner, circleId, { timesOfDay: ['08:00'] });
    const list = await owner.auth(request(app).get(`/api/circles/${circleId}/occurrences`)).expect(200);
    const dose = list.body.occurrences[0];

    const results = await Promise.all(
      [owner, ...others].map((person) =>
        person
          .auth(request(app).post(`/api/circles/${circleId}/occurrences/${dose._id}/resolve`))
          .send({ status: 'given' })
      )
    );

    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(4);
  });
});

describe('undoing a dose', () => {
  it('lets the person who recorded it take it back', async () => {
    const user = await signUp(app);
    const circle = await createCircle(app, user);
    const circleId = circle.id ?? circle._id;
    await addMedication(app, user, circleId, { timesOfDay: ['08:00'] });

    const list = await user.auth(request(app).get(`/api/circles/${circleId}/occurrences`)).expect(200);
    const dose = list.body.occurrences[0];

    await user
      .auth(request(app).post(`/api/circles/${circleId}/occurrences/${dose._id}/resolve`))
      .send({ status: 'given' })
      .expect(200);

    const undone = await user
      .auth(request(app).post(`/api/circles/${circleId}/occurrences/${dose._id}/undo`))
      .expect(200);

    expect(undone.body.occurrence.status).toBe('due');
    expect(undone.body.occurrence.resolvedBy).toBeNull();
  });

  it('stops a caregiver rewriting somebody else’s entry', async () => {
    const priya = await signUp(app, { name: 'Priya' });
    const circle = await createCircle(app, priya);
    const circleId = circle.id ?? circle._id;

    const arjun = await signUp(app, { name: 'Arjun' });
    await priya
      .auth(request(app).post(`/api/circles/${circleId}/members`))
      .send({ email: arjun.email, role: 'caregiver' })
      .expect(201);

    await addMedication(app, priya, circleId, { timesOfDay: ['08:00'] });
    const list = await priya.auth(request(app).get(`/api/circles/${circleId}/occurrences`)).expect(200);
    const dose = list.body.occurrences[0];

    await priya
      .auth(request(app).post(`/api/circles/${circleId}/occurrences/${dose._id}/resolve`))
      .send({ status: 'given' })
      .expect(200);

    // A log anyone can quietly rewrite is worse than no log, because people
    // would still trust it.
    await arjun
      .auth(request(app).post(`/api/circles/${circleId}/occurrences/${dose._id}/undo`))
      .expect(403);
  });

  it('lets an admin undo on someone else’s behalf', async () => {
    const admin = await signUp(app, { name: 'Admin' });
    const circle = await createCircle(app, admin);
    const circleId = circle.id ?? circle._id;

    const helper = await signUp(app, { name: 'Helper' });
    await admin
      .auth(request(app).post(`/api/circles/${circleId}/members`))
      .send({ email: helper.email, role: 'caregiver' })
      .expect(201);

    await addMedication(app, admin, circleId, { timesOfDay: ['08:00'] });
    const list = await admin.auth(request(app).get(`/api/circles/${circleId}/occurrences`)).expect(200);
    const dose = list.body.occurrences[0];

    await helper
      .auth(request(app).post(`/api/circles/${circleId}/occurrences/${dose._id}/resolve`))
      .send({ status: 'given' })
      .expect(200);

    await admin
      .auth(request(app).post(`/api/circles/${circleId}/occurrences/${dose._id}/undo`))
      .expect(200);
  });
});

describe('regenerating the schedule', () => {
  it('never un-ticks a dose somebody already gave', async () => {
    const user = await signUp(app);
    const circle = await createCircle(app, user);
    const circleId = circle.id ?? circle._id;
    await addMedication(app, user, circleId, { timesOfDay: ['08:00'] });

    const list = await user.auth(request(app).get(`/api/circles/${circleId}/occurrences`)).expect(200);
    const dose = list.body.occurrences[0];

    await user
      .auth(request(app).post(`/api/circles/${circleId}/occurrences/${dose._id}/resolve`))
      .send({ status: 'given', note: 'done' })
      .expect(200);

    // Generation runs on every read, so this is the ordinary path, not a
    // contrived one.
    const circleDoc = await Circle.findById(circleId);
    await ensureOccurrences(circleDoc);
    await ensureOccurrences(circleDoc);

    const again = await user.auth(request(app).get(`/api/circles/${circleId}/occurrences`)).expect(200);
    const same = again.body.occurrences.find((o) => o._id === dose._id);

    expect(same.status).toBe('given');
    expect(same.note).toBe('done');
  });

  it('does not duplicate doses however often it runs', async () => {
    const user = await signUp(app);
    const circle = await createCircle(app, user);
    const circleId = circle.id ?? circle._id;
    await addMedication(app, user, circleId, { timesOfDay: ['08:00', '20:00'] });

    const circleDoc = await Circle.findById(circleId);
    await Promise.all([
      ensureOccurrences(circleDoc),
      ensureOccurrences(circleDoc),
      ensureOccurrences(circleDoc),
    ]);

    const onToday = await Occurrence.countDocuments({ circle: circleId, localDate: today() });
    expect(onToday).toBe(2);
  });
});
