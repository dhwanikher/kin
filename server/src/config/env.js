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
};

export const isProduction = config.env === 'production';
