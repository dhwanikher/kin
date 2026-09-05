import crypto from 'node:crypto';
import mongoose from 'mongoose';
import request from 'supertest';

import { createApp } from '../src/app.js';

/**
 * A throwaway database per test file. Real MongoDB rather than an in-memory
 * stand-in, because the behaviour under test — unique indexes and atomic
 * findOneAndUpdate — is exactly the behaviour a fake would have to emulate,
 * and a fake that emulates it is not evidence that the real thing works.
 */
export async function useTestDatabase() {
  const name = `kin_test_${crypto.randomBytes(6).toString('hex')}`;
  const uri = process.env.MONGO_TEST_URI ?? `mongodb://127.0.0.1:27017/${name}`;

  mongoose.set('strictQuery', true);
  await mongoose.connect(uri);
  await Promise.all(mongoose.modelNames().map((m) => mongoose.model(m).syncIndexes()));

  return async function teardown() {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  };
}

export function api() {
  return createApp();
}

let counter = 0;

/** Registers a user and returns an authenticated request helper. */
export async function signUp(app, overrides = {}) {
  const suffix = `${Date.now()}-${counter++}`;
  const payload = {
    name: overrides.name ?? `Tester ${suffix}`,
    email: overrides.email ?? `user-${suffix}@example.test`,
    password: overrides.password ?? 'correct-horse-battery',
  };

  const res = await request(app).post('/api/auth/register').send(payload).expect(201);

  return {
    ...payload,
    id: res.body.user.id ?? res.body.user._id,
    token: res.body.accessToken,
    auth: (req) => req.set('Authorization', `Bearer ${res.body.accessToken}`),
  };
}

export async function createCircle(app, user, body = {}) {
  const res = await user
    .auth(request(app).post('/api/circles'))
    .send({ name: body.name ?? 'Dad', timezone: body.timezone ?? 'Asia/Kolkata' })
    .expect(201);
  return res.body.circle;
}

export async function addMedication(app, user, circleId, body = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const res = await user
    .auth(request(app).post(`/api/circles/${circleId}/medications`))
    .send({
      name: body.name ?? 'Amlodipine',
      dose: body.dose ?? '1 tablet',
      timesOfDay: body.timesOfDay ?? ['08:00', '20:00'],
      startDate: body.startDate ?? today,
      ...body,
    })
    .expect(201);
  return res.body.medication;
}
