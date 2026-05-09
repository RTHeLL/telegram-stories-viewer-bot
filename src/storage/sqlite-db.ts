import Database from 'better-sqlite3';
import { SQLITE_DATABASE_PATH } from 'config/env-config';
import fs from 'fs';
import path from 'path';

let sqliteDb: Database.Database | null = null;

/**
 * Одно подключение к SQLite по пути из env (SQLITE_DATABASE_PATH).
 */
export function getSharedSqlite(): Database.Database {
  if (sqliteDb) return sqliteDb;
  const filePath = path.resolve(process.cwd(), SQLITE_DATABASE_PATH);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  sqliteDb = new Database(filePath);
  sqliteDb.pragma('journal_mode = WAL');
  sqliteDb.pragma('foreign_keys = ON');
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  return sqliteDb;
}
