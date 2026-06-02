import db from '@/lib/db';

const _db = db.$client;

export function getSetting(key: string): string | null {
  const row = _db
    .prepare('SELECT value FROM instance_settings WHERE key = ?')
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  _db
    .prepare(
      'INSERT OR REPLACE INTO instance_settings (key, value) VALUES (?, ?)',
    )
    .run(key, value);
}

export function deleteSetting(key: string): void {
  _db.prepare('DELETE FROM instance_settings WHERE key = ?').run(key);
}

export interface InstanceDefaults {
  chatProviderId: string | null;
  chatModelKey: string | null;
  embeddingProviderId: string | null;
  embeddingModelKey: string | null;
}

export function loadDefaults(): InstanceDefaults {
  return {
    chatProviderId: getSetting('default_chat_provider_id'),
    chatModelKey: getSetting('default_chat_model_key'),
    embeddingProviderId: getSetting('default_embedding_provider_id'),
    embeddingModelKey: getSetting('default_embedding_model_key'),
  };
}
