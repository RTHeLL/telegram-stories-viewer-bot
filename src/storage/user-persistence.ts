import {
  DATA_STORAGE,
  SUPABASE_API_KEY,
  SUPABASE_PROJECT_URL,
} from 'config/env-config';
import { User } from 'telegraf/typings/core/types/typegram';

import { createClient, SupabaseClient } from '@supabase/supabase-js';

import { getSharedSqlite } from './sqlite-db';

let supabaseClient: SupabaseClient | null = null;

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
    const db = getSharedSqlite();
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
