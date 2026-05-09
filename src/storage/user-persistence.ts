import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  DATA_STORAGE,
  SQLITE_DATABASE_PATH,
  SUPABASE_API_KEY,
  SUPABASE_PROJECT_URL,
} from 'config/env-config';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { User } from 'telegraf/typings/core/types/typegram';

let sqliteDb: Database.Database | null = null;
let supabaseClient: SupabaseClient | null = null;

function getSqliteDb(): Database.Database {
  if (sqliteDb) return sqliteDb;
  const filePath = path.resolve(process.cwd(), SQLITE_DATABASE_PATH);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  sqliteDb = new Database(filePath);
  sqliteDb.pragma('journal_mode = WAL');
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  return sqliteDb;
}

function getSupabase(): SupabaseClient {
  if (!supabaseClient) {
    supabaseClient = createClient(SUPABASE_PROJECT_URL, SUPABASE_API_KEY);
  }
  return supabaseClient;
}

/**
 * @returns true если пользователь был впервые записан в хранилище
 */
export async function insertUserIfAbsent(user: User): Promise<boolean> {
  if (DATA_STORAGE === 'sqlite') {
    const db = getSqliteDb();
    const exists = db
      .prepare('SELECT 1 AS ok FROM users WHERE id = ?')
      .get(user.id) as { ok: number } | undefined;
    if (exists) return false;
    db.prepare('INSERT INTO users (id, payload) VALUES (?, ?)').run(
      user.id,
      JSON.stringify(user)
    );
    return true;
  }

  const supabase = getSupabase();
  const { data } = await supabase.from('users').select('id').eq('id', user.id);
  if (data?.length) return false;
  await supabase.from('users').insert([user]);
  return true;
}
