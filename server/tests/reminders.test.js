import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

// The transport is mocked so these tests are about the *decision* to disturb
// somebody, not about whether a push service accepted a payload. Every rule
// below exists because getting it wrong either wakes a family at 3am or fails
// to tell them a tablet was missed.
const sent = [];
vi.mock('../src/services/push.js', () => ({
  pushEnabled: () => true,
  publicKey: () => 'test-key',
  sendToUsers: async (userIds, payload) => {
    sent.push({ userIds: userIds.map(String), payload });
    return { sent: userIds.length, pruned: 0, failed: 0 };
  },
}));

const { sweepOverdue } = await import('../src/services/reminders.js');
const { Occurrence, Membership } = await import('../src/models/index.js');
const { addMedication, api, createCircle, signUp, useTestDatabase } = await import('./helpers.js');

let teardown;
const app = api();

beforeAll(async () => {
  teardown = await useTestDatabase();
});
afterAll(async () => {
  await teardown();
});
// The sweep is global by design — it looks at every overdue dose in the
// database, not one circle's. Tests in this file therefore have to clear
// occurrences between cases, or a dose left behind by an earlier test is
// legitimately picked up by a later one and the counts stop meaning anything.
afterEach(async () => {
  sent.length = 0;
  await Occurrence.deleteMany({});
});

/** A circle with one medication and its doses materialised. */
async function circleWithDoses() {
  const owner = await signUp(app, { name: 'Owner' });
  const circle = await createCircle(app, owner);
  const circleId = circle.id ?? circle._id;
  await addMedication(app, owner, circleId, { timesOfDay: ['08:00'] });
  await owner.auth(request(app).get(`/api/circles/${circleId}/occurrences`)).expect(200);
  const dose = await Occurrence.findOne({ circle: circleId });
  return { owner, circleId, dose };
}

describe('when a reminder is sent', () => {
  it('says nothing until the grace period has passed', async () => {
    const { dose } = await circleWithDoses();

    // Ten minutes late, with a thirty minute grace period.
    const now = new Date(dose.dueAt.getTime() + 10 * 60 * 1000);
    const result = await sweepOverdue({ now });

    expect(result.notified).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it('sends once the dose is properly late', async () => {
    const { dose } = await circleWithDoses();
    const now = new Date(dose.dueAt.getTime() + 45 * 60 * 1000);

    const result = await sweepOverdue({ now });

    expect(result.notified).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].payload.title).toMatch(/overdue/i);
    expect(sent[0].payload.occurrenceId).toBe(String(dose._id));
  });

  it('never sends twice about the same dose', async () => {
    const { dose } = await circleWithDoses();
    const now = new Date(dose.dueAt.getTime() + 45 * 60 * 1000);

    await sweepOverdue({ now });
    await sweepOverdue({ now: new Date(now.getTime() + 60 * 60 * 1000) });
    await sweepOverdue({ now: new Date(now.getTime() + 6 * 60 * 60 * 1000) });

    // Nagging is how notifications get switched off, and someone who has
    // switched them off is worse than someone who never had them.
    expect(sent).toHaveLength(1);
  });

  it('says nothing about a dose that was already dealt with', async () => {
    const { owner, circleId, dose } = await circleWithDoses();

    await owner
      .auth(request(app).post(`/api/circles/${circleId}/occurrences/${dose._id}/resolve`))
      .send({ status: 'given' })
      .expect(200);

    const now = new Date(dose.dueAt.getTime() + 45 * 60 * 1000);
    const result = await sweepOverdue({ now });

    expect(result.notified).toBe(0);
    expect(sent).toHaveLength(0);
  });
});

describe('who gets told', () => {
  it('tells the people who can act, and leaves viewers alone', async () => {
    const { owner, circleId, dose } = await circleWithDoses();

    const helper = await signUp(app, { name: 'Helper' });
    const watcher = await signUp(app, { name: 'Watcher' });

    await owner
      .auth(request(app).post(`/api/circles/${circleId}/members`))
      .send({ email: helper.email, role: 'caregiver' })
      .expect(201);
    await owner
      .auth(request(app).post(`/api/circles/${circleId}/members`))
      .send({ email: watcher.email, role: 'viewer' })
      .expect(201);

    await sweepOverdue({ now: new Date(dose.dueAt.getTime() + 45 * 60 * 1000) });

    expect(sent).toHaveLength(1);
    const audience = sent[0].userIds;

    // A viewer cannot record a dose, so waking them achieves nothing.
    expect(audience).toContain(String(owner.id));
    expect(audience).toContain(String(helper.id));
    expect(audience).not.toContain(String(watcher.id));
  });

  it('does not send at all when nobody in the circle can act', async () => {
    const { circleId, dose } = await circleWithDoses();
    // Strip the circle of anyone able to respond.
    await Membership.deleteMany({ circle: circleId });

    const result = await sweepOverdue({ now: new Date(dose.dueAt.getTime() + 45 * 60 * 1000) });

    expect(result.notified).toBe(0);
    expect(sent).toHaveLength(0);
  });
});

/**
 * The sweep runs on a timer. A slow sweep and the next tick can overlap, and a
 * duplicate notification about medication is exactly the kind of thing that
 * prompts somebody to give a second tablet.
 */
describe('two sweeps running at once', () => {
  it('sends exactly one notification per dose', async () => {
    const { dose } = await circleWithDoses();
    const now = new Date(dose.dueAt.getTime() + 45 * 60 * 1000);

    await Promise.all([
      sweepOverdue({ now }),
      sweepOverdue({ now }),
      sweepOverdue({ now }),
    ]);

    expect(sent).toHaveLength(1);
  });

  it('marks the dose as reminded so a later sweep can see it was handled', async () => {
    const { dose } = await circleWithDoses();
    await sweepOverdue({ now: new Date(dose.dueAt.getTime() + 45 * 60 * 1000) });

    const after = await Occurrence.findById(dose._id);
    expect(after.remindedAt).toBeTruthy();
    // The dose itself is untouched — a reminder is not an action on the dose.
    expect(after.status).toBe('due');
  });
});
