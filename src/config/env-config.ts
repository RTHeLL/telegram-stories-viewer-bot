import { config } from 'dotenv';

const { parsed } = config();

export const getEnvVar = (key: string) => {
  // После config() ключи из .env попадают в process.env. Переменные только из
  // окружения (Docker/K8s) могут быть в process.env без ключа в parsed — не падать из‑за parsed.
  const value = process.env[key] ?? parsed?.[key];
  if (value === undefined || value === '') {
    throw new Error(`Env variable ${key} is required`);
  }
  return value;
};

const getEnvVarOptional = (key: string, defaultValue: string) => {
  const fromEnv = process.env[key];
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv;
  const fromFile = parsed?.[key];
  if (fromFile !== undefined && fromFile !== '') return fromFile;
  return defaultValue;
};

export type DataStorageDriver = 'sqlite' | 'supabase';

const parseDataStorage = (): DataStorageDriver => {
  const raw = process.env.DATA_STORAGE ?? parsed?.DATA_STORAGE;
  if (raw === undefined || String(raw).trim() === '') {
    return 'supabase';
  }
  const normalized = raw.toLowerCase();
  if (normalized === 'sqlite' || normalized === 'supabase') return normalized;
  throw new Error(`DATA_STORAGE must be "sqlite" or "supabase", got: "${raw}"`);
};

/** Runtime mode */
export const NODE_ENV = getEnvVar('NODE_ENV');
/** Dev mode */
export const isDevEnv = NODE_ENV === 'development';
/** Prod mode */
export const isProdEnv = NODE_ENV === 'production';

/** bot's token */
export const BOT_TOKEN = isDevEnv
  ? getEnvVar('DEV_BOT_TOKEN')
  : getEnvVar('PROD_BOT_TOKEN');

/** Telegram id of bot admin */
export const BOT_ADMIN_ID = Number(getEnvVar('BOT_ADMIN_ID'));

// userbot
export const USERBOT_API_ID = Number(getEnvVar('USERBOT_API_ID'));
export const USERBOT_API_HASH = getEnvVar('USERBOT_API_HASH');
export const USERBOT_PHONE_NUMBER = getEnvVar('USERBOT_PHONE_NUMBER');

/** Куда писать данные пользователей: sqlite (локальный файл) или supabase */
export const DATA_STORAGE: DataStorageDriver = parseDataStorage();

/** Путь к файлу БД относительно cwd; только для DATA_STORAGE=sqlite */
export const SQLITE_DATABASE_PATH =
  DATA_STORAGE === 'sqlite'
    ? getEnvVarOptional('SQLITE_DATABASE_PATH', 'data/users.db')
    : '';

const parseMonitorIntervalMs = (): number => {
  const raw = process.env.MONITOR_INTERVAL_MS ?? parsed?.MONITOR_INTERVAL_MS;
  if (raw === undefined || String(raw).trim() === '') {
    return 3_600_000;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 60_000) {
    throw new Error(
      'MONITOR_INTERVAL_MS must be a finite number >= 60000 (1 minute)'
    );
  }
  return Math.floor(n);
};

/** Интервал фонового мониторинга подписок (мс). По умолчанию 1 час. */
export const MONITOR_INTERVAL_MS = parseMonitorIntervalMs();

// supabase (обязательны только при DATA_STORAGE=supabase)
export const SUPABASE_PROJECT_URL =
  DATA_STORAGE === 'supabase' ? getEnvVar('SUPABASE_PROJECT_URL') : '';

export const SUPABASE_API_KEY =
  DATA_STORAGE === 'supabase' ? getEnvVar('SUPABASE_API_KEY') : '';
