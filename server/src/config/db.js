import mongoose from 'mongoose';
import { config } from './env.js';

export async function connectDb(uri = config.mongoUri) {
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri);
  // Indexes carry correctness here, not just speed — the unique index on
  // (medication, dueAt) is what makes duplicate doses impossible — so the app
  // waits for them rather than serving traffic while they build.
  await Promise.all(mongoose.modelNames().map((name) => mongoose.model(name).syncIndexes()));
  return mongoose.connection;
}

export async function disconnectDb() {
  await mongoose.disconnect();
}
