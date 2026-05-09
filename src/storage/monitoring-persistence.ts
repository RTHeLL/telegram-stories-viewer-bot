import Database from 'better-sqlite3';
import {
  DATA_STORAGE,
  SUPABASE_API_KEY,
  SUPABASE_PROJECT_URL,
} from 'config/env-config';

import { createClient, SupabaseClient } from '@supabase/supabase-js';

import { getSharedSqlite } from './sqlite-db';

/** Метаданные одной истории для истории без бинарных данных */
export interface StorySnapshotMeta {
  id: number;
  dateUnix: number;
  mediaType: 'photo' | 'video' | 'unknown';
  caption?: string;
  kind: 'active' | 'pinned';
}

export interface StoryHistoryPayload {
  stories: StorySnapshotMeta[];
}

export interface MonitoredTargetRow {
  id: number;
  owner_chat_id: string;
  target_link: string;
  enabled: number;
  created_at: string;
}

export interface StoryHistoryRow {
  id: number;
  owner_chat_id: string;
  target_link: string;
  monitored_target_id: number | null;
  source: 'manual' | 'monitor';
  fetched_at: string;
  payload_json: string;
}

let supabaseClient: SupabaseClient | null = null;

function getSqlite(): Database.Database {
  return getSharedSqlite();
}

function getSupabase(): SupabaseClient {
  if (!supabaseClient) {
    supabaseClient = createClient(SUPABASE_PROJECT_URL, SUPABASE_API_KEY);
  }
  return supabaseClient;
}

function ensureSqliteMonitoringSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS monitored_targets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_chat_id TEXT NOT NULL,
      target_link TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(owner_chat_id, target_link)
    );
    CREATE TABLE IF NOT EXISTS story_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_chat_id TEXT NOT NULL,
      target_link TEXT NOT NULL,
      monitored_target_id INTEGER,
      source TEXT NOT NULL,
      fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
      payload_json TEXT NOT NULL,
      FOREIGN KEY (monitored_target_id) REFERENCES monitored_targets(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_story_history_owner_target
      ON story_history(owner_chat_id, target_link);
  `);
}

export function initMonitoringSchema() {
  if (DATA_STORAGE === 'sqlite') {
    ensureSqliteMonitoringSchema(getSharedSqlite());
  }
}

function normalizeTargetLink(raw: string): string {
  return raw.trim().replace(/^@+/u, '@');
}

export async function addMonitoredTarget(
  owner_chat_id: string,
  rawLink: string
): Promise<{ id: number } | { error: string }> {
  const target_link = normalizeTargetLink(rawLink);
  if (!target_link.startsWith('@') && !target_link.startsWith('+')) {
    return { error: 'Укажите @username или номер в формате +71234567890' };
  }

  if (DATA_STORAGE === 'sqlite') {
    const db = getSqlite();
    ensureSqliteMonitoringSchema(db);
    try {
      const info = db
        .prepare(
          `INSERT INTO monitored_targets (owner_chat_id, target_link, enabled)
           VALUES (?, ?, 1)`
        )
        .run(owner_chat_id, target_link);
      return { id: Number(info.lastInsertRowid) };
    } catch {
      return { error: 'Этот объект уже в списке мониторинга.' };
    }
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('monitored_targets')
    .insert({ owner_chat_id, target_link, enabled: true })
    .select('id')
    .single();

  if (error) {
    if (error.code === '23505' || error.message.includes('duplicate')) {
      return { error: 'Этот объект уже в списке мониторинга.' };
    }
    throw error;
  }
  return { id: data.id as number };
}

export async function removeMonitoredTarget(
  owner_chat_id: string,
  id: number
): Promise<boolean> {
  if (DATA_STORAGE === 'sqlite') {
    const db = getSqlite();
    ensureSqliteMonitoringSchema(db);
    const info = db
      .prepare(
        'DELETE FROM monitored_targets WHERE id = ? AND owner_chat_id = ?'
      )
      .run(id, owner_chat_id);
    return info.changes > 0;
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('monitored_targets')
    .delete()
    .eq('id', id)
    .eq('owner_chat_id', owner_chat_id)
    .select('id');

  if (error) throw error;
  return Boolean(data?.length);
}

export async function setMonitoredTargetEnabled(
  owner_chat_id: string,
  id: number,
  enabled: boolean
): Promise<boolean> {
  if (DATA_STORAGE === 'sqlite') {
    const db = getSqlite();
    ensureSqliteMonitoringSchema(db);
    const info = db
      .prepare(
        'UPDATE monitored_targets SET enabled = ? WHERE id = ? AND owner_chat_id = ?'
      )
      .run(enabled ? 1 : 0, id, owner_chat_id);
    return info.changes > 0;
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('monitored_targets')
    .update({ enabled })
    .eq('id', id)
    .eq('owner_chat_id', owner_chat_id)
    .select('id');

  if (error) throw error;
  return Boolean(data?.length);
}

export async function listMonitoredTargetsForOwner(
  owner_chat_id: string
): Promise<MonitoredTargetRow[]> {
  if (DATA_STORAGE === 'sqlite') {
    const db = getSqlite();
    ensureSqliteMonitoringSchema(db);
    return db
      .prepare(
        `SELECT id, owner_chat_id, target_link, enabled, created_at
         FROM monitored_targets WHERE owner_chat_id = ?
         ORDER BY id DESC`
      )
      .all(owner_chat_id) as MonitoredTargetRow[];
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('monitored_targets')
    .select('id, owner_chat_id, target_link, enabled, created_at')
    .eq('owner_chat_id', owner_chat_id)
    .order('id', { ascending: false });

  if (error) throw error;
  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: row.id as number,
    owner_chat_id: String(row.owner_chat_id),
    target_link: row.target_link as string,
    enabled: row.enabled === true || row.enabled === 1 ? 1 : 0,
    created_at: String(row.created_at),
  }));
}

export async function getMonitoredTargetForOwner(
  owner_chat_id: string,
  id: number
): Promise<MonitoredTargetRow | null> {
  if (DATA_STORAGE === 'sqlite') {
    const db = getSqlite();
    ensureSqliteMonitoringSchema(db);
    const row = db
      .prepare(
        `SELECT id, owner_chat_id, target_link, enabled, created_at
         FROM monitored_targets WHERE id = ? AND owner_chat_id = ?`
      )
      .get(id, owner_chat_id) as MonitoredTargetRow | undefined;
    return row ?? null;
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('monitored_targets')
    .select('id, owner_chat_id, target_link, enabled, created_at')
    .eq('id', id)
    .eq('owner_chat_id', owner_chat_id)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id as number,
    owner_chat_id: String(data.owner_chat_id),
    target_link: data.target_link as string,
    enabled: data.enabled === true || data.enabled === 1 ? 1 : 0,
    created_at: String(data.created_at),
  };
}

/** Все включённые подписки (для планировщика) */
export async function listAllEnabledMonitoredTargets(): Promise<
  MonitoredTargetRow[]
> {
  if (DATA_STORAGE === 'sqlite') {
    const db = getSqlite();
    ensureSqliteMonitoringSchema(db);
    return db
      .prepare(
        `SELECT id, owner_chat_id, target_link, enabled, created_at
         FROM monitored_targets WHERE enabled = 1 ORDER BY id ASC`
      )
      .all() as MonitoredTargetRow[];
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('monitored_targets')
    .select('id, owner_chat_id, target_link, enabled, created_at')
    .eq('enabled', true)
    .order('id', { ascending: true });

  if (error) throw error;
  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: row.id as number,
    owner_chat_id: String(row.owner_chat_id),
    target_link: row.target_link as string,
    enabled: 1,
    created_at: String(row.created_at),
  }));
}

export async function getLastHistoryForTarget(
  owner_chat_id: string,
  target_link: string
): Promise<StoryHistoryRow | null> {
  const normalized = normalizeTargetLink(target_link);
  if (DATA_STORAGE === 'sqlite') {
    const db = getSqlite();
    ensureSqliteMonitoringSchema(db);
    const row = db
      .prepare(
        `SELECT id, owner_chat_id, target_link, monitored_target_id, source, fetched_at, payload_json
         FROM story_history
         WHERE owner_chat_id = ? AND target_link = ?
         ORDER BY id DESC LIMIT 1`
      )
      .get(owner_chat_id, normalized) as StoryHistoryRow | undefined;
    return row ?? null;
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('story_history')
    .select(
      'id, owner_chat_id, target_link, monitored_target_id, source, fetched_at, payload_json'
    )
    .eq('owner_chat_id', owner_chat_id)
    .eq('target_link', normalized)
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id as number,
    owner_chat_id: String(data.owner_chat_id),
    target_link: data.target_link as string,
    monitored_target_id: data.monitored_target_id as number | null,
    source: data.source as 'manual' | 'monitor',
    fetched_at: String(data.fetched_at),
    payload_json: data.payload_json as string,
  };
}

export async function insertStoryHistory(input: {
  owner_chat_id: string;
  target_link: string;
  monitored_target_id?: number | null;
  source: 'manual' | 'monitor';
  payload: StoryHistoryPayload;
}): Promise<void> {
  const target_link = normalizeTargetLink(input.target_link);
  const payload_json = JSON.stringify(input.payload);

  if (DATA_STORAGE === 'sqlite') {
    const db = getSqlite();
    ensureSqliteMonitoringSchema(db);
    db.prepare(
      `INSERT INTO story_history
        (owner_chat_id, target_link, monitored_target_id, source, payload_json)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      input.owner_chat_id,
      target_link,
      input.monitored_target_id ?? null,
      input.source,
      payload_json
    );
    return;
  }

  const supabase = getSupabase();
  const { error } = await supabase.from('story_history').insert({
    owner_chat_id: input.owner_chat_id,
    target_link,
    monitored_target_id: input.monitored_target_id ?? null,
    source: input.source,
    payload_json,
  });

  if (error) throw error;
}

export async function listStoryHistoryPage(input: {
  owner_chat_id: string;
  target_link: string;
  limit: number;
  offset: number;
}): Promise<StoryHistoryRow[]> {
  const target_link = normalizeTargetLink(input.target_link);
  if (DATA_STORAGE === 'sqlite') {
    const db = getSqlite();
    ensureSqliteMonitoringSchema(db);
    return db
      .prepare(
        `SELECT id, owner_chat_id, target_link, monitored_target_id, source, fetched_at, payload_json
         FROM story_history
         WHERE owner_chat_id = ? AND target_link = ?
         ORDER BY id DESC LIMIT ? OFFSET ?`
      )
      .all(
        input.owner_chat_id,
        target_link,
        input.limit,
        input.offset
      ) as StoryHistoryRow[];
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('story_history')
    .select(
      'id, owner_chat_id, target_link, monitored_target_id, source, fetched_at, payload_json'
    )
    .eq('owner_chat_id', input.owner_chat_id)
    .eq('target_link', target_link)
    .order('id', { ascending: false })
    .range(input.offset, input.offset + input.limit - 1);

  if (error) throw error;
  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: row.id as number,
    owner_chat_id: String(row.owner_chat_id),
    target_link: row.target_link as string,
    monitored_target_id: row.monitored_target_id as number | null,
    source: row.source as 'manual' | 'monitor',
    fetched_at: String(row.fetched_at),
    payload_json: row.payload_json as string,
  }));
}

export async function getStoryHistoryByIdForOwner(
  owner_chat_id: string,
  historyId: number
): Promise<StoryHistoryRow | null> {
  if (DATA_STORAGE === 'sqlite') {
    const db = getSqlite();
    ensureSqliteMonitoringSchema(db);
    const row = db
      .prepare(
        `SELECT id, owner_chat_id, target_link, monitored_target_id, source, fetched_at, payload_json
         FROM story_history WHERE id = ? AND owner_chat_id = ?`
      )
      .get(historyId, owner_chat_id) as StoryHistoryRow | undefined;
    return row ?? null;
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('story_history')
    .select(
      'id, owner_chat_id, target_link, monitored_target_id, source, fetched_at, payload_json'
    )
    .eq('id', historyId)
    .eq('owner_chat_id', owner_chat_id)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id as number,
    owner_chat_id: String(data.owner_chat_id),
    target_link: data.target_link as string,
    monitored_target_id: data.monitored_target_id as number | null,
    source: data.source as 'manual' | 'monitor',
    fetched_at: String(data.fetched_at),
    payload_json: data.payload_json as string,
  };
}
