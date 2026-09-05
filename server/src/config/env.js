import 'dotenv/config';

const required = (name, fallback) => {
  const value = process.env[name] ?? fallback;
  if (value === undefined) throw new Error(`Missing required environment variable ${name}`);
  return value;
};

export const config = {
  port: Number(process.env.PORT ?? 4000),
  mongoUri: process.env.MONGO_URI ?? 'mongodb://127.0.0.1:27017/kin',
  clientOrigin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173',
  env: process.env.NODE_ENV ?? 'development',

  // Refusing to boot without real secrets in production is deliberate. A
  // default secret that works locally is a default secret that ships.
  accessSecret:
    process.env.NODE_ENV === 'production'
      ? required('JWT_ACCESS_SECRET')
      : process.env.JWT_ACCESS_SECRET ?? 'dev-access-secret',
  refreshSecret:
    process.env.NODE_ENV === 'production'
      ? required('JWT_REFRESH_SECRET')
      : process.env.JWT_REFRESH_SECRET ?? 'dev-refresh-secret',

  accessTtl: '15m',
  refreshTtl: '30d',

  vapid: {
    publicKey: process.env.VAPID_PUBLIC_KEY ?? '',
    privateKey: process.env.VAPID_PRIVATE_KEY ?? '',
    subject: process.env.VAPID_SUBJECT ?? 'mailto:kin@example.com',
  },
  // How often the overdue sweep runs. Short in development so the behaviour is
  // observable; a minute is plenty in production, since the grace period is
  // measured in tens of minutes.
  reminderSweepSeconds: Number(process.env.REMINDER_SWEEP_SECONDS ?? 60),
  // How late a dose has to be before anyone is disturbed about it.
  reminderGraceMinutes: Number(process.env.REMINDER_GRACE_MINUTES ?? 30),
};

export const isProduction = config.env === 'production';
