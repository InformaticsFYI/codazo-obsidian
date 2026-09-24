import { z } from 'zod';
import type { KeyVault, SettingsPersistence } from '../shared/lib/settings/local-settings-store';

/** Everything the plugin keeps in data.json. Never the key, never learner text. */
export const PluginDataSchema = z.strictObject({
  version: z.literal(1),
  artifactFolder: z.string().min(1).max(200),
  level: z.enum(['beginner', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2']),
  /** Legacy single-provider record from the shared settings store (migrated into profiles on load), or null. */
  provider: z.string().max(4000).nullable(),
  /** Serialized profiles record owned by ProfileStore, or null. Never contains a key. */
  profiles: z.string().max(40_000).nullable().default(null),
  /** Set once the learner has seen that saved artifacts are plain vault files. */
  storageDisclosureSeen: z.boolean(),
  /** Save every validated review into the artifact folder as soon as it arrives. Off by default; the toggle is the consent. */
  autoSaveReviews: z.boolean().default(false),
  /** Create one note per word and per verb-tense under Palabras/ and Verbos/ after every review or study guide. Existing notes are never touched. */
  autoStudyNotes: z.boolean().default(false),
  /** Whether the pane's collapsible sections (summary, observations, words, verbs) start open. */
  sectionsOpen: z.boolean().default(true),
  /** Plugin interface language only; never affects Codazo's output. */
  uiLanguage: z.enum(['es', 'en']).default('es'),
});
export type PluginData = z.infer<typeof PluginDataSchema>;
export const DEFAULT_DATA: PluginData = { version: 1, artifactFolder: 'Codazo', level: 'A2', provider: null, storageDisclosureSeen: false, autoSaveReviews: false, profiles: null, uiLanguage: 'es', autoStudyNotes: false, sectionsOpen: true };

/** Unknown or damaged plugin data falls back to defaults instead of guessing. */
export function parsePluginData(input: unknown): PluginData {
  const parsed = PluginDataSchema.safeParse(input);
  return parsed.success ? parsed.data : { ...DEFAULT_DATA };
}

/** A store reads and writes its record inside plugin data. */
export function recordPersistence(field: 'provider' | 'profiles', read: () => PluginData, write: (next: PluginData) => Promise<void>): SettingsPersistence {
  return {
    read: async () => read()[field],
    write: async value => write({ ...read(), [field]: value }),
    remove: async () => write({ ...read(), [field]: null }),
  };
}
export const providerRecordPersistence = (read: () => PluginData, write: (next: PluginData) => Promise<void>) => recordPersistence('provider', read, write);

/** Obsidian accepts only lowercase alphanumeric IDs with dashes; anything else throws on setSecret. */
export const SECRET_ID = 'codazo-provider-key';
export type SecretStorageLike = { getSecret(id: string): string | null; setSecret(id: string, secret: string): void };

/**
 * Obsidian Secret Storage as the plugin's key vault. Absent storage (older
 * Obsidian) is reported as unavailable; the shared store then refuses
 * persistent mode and keeps the key session-only. Secret Storage has no
 * remove call, so removal writes an empty secret, which reads back as absent.
 */
/** Anything with string values we can scan for a plaintext canary; the webview's localStorage in Obsidian. */
export type StringStoreLike = { length: number; key(index: number): string | null; getItem(key: string): string | null };

/**
 * Obsidian's public API cannot say whether Secret Storage is encrypting, and
 * when the OS keychain is unavailable it stores secrets in Local Storage as
 * plain text. So the check is behavioral: write a random canary through the
 * real API and look for its plaintext in Local Storage. Found → encryption is
 * off → persistent mode is refused. The canary is blanked afterwards.
 */
export function probeSecretEncryption(storage: SecretStorageLike, store: StringStoreLike | undefined, canaryId = `${SECRET_ID}-canary`): boolean {
  const token = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
  try {
    storage.setSecret(canaryId, token);
    if (storage.getSecret(canaryId) !== token) return false;
    if (!store) return false; // cannot inspect the persistence path → not established → refuse
    for (let i = 0; i < store.length; i++) { const key = store.key(i); const value = key === null ? null : store.getItem(key); if (value && value.includes(token)) return false; }
    return true;
  } catch { return false; } finally { try { storage.setSecret(canaryId, ''); } catch { /* nothing to clean */ } }
}

export function createSecretVault(storage: SecretStorageLike | undefined, id: string = SECRET_ID, store?: StringStoreLike): KeyVault {
  return {
    available: async () => storage !== undefined && probeSecretEncryption(storage, store),
    read: async () => { const value = storage?.getSecret(id); return value ? value : null; },
    write: async value => { if (!storage) throw new Error('SECURE_STORAGE_UNAVAILABLE'); storage.setSecret(id, value); },
    remove: async () => { storage?.setSecret(id, ''); },
  };
}
/** Per-profile secret IDs; profile IDs are already lowercase alphanumeric with dashes. */
export const profileSecretId = (profileId: string) => `${SECRET_ID}-${profileId}`;

/**
 * One-time migration of the single-provider record (and its secret) into a
 * profile named after its provider. Returns the profiles record to store, or
 * null when there is nothing to migrate.
 */
export function migrateLegacyProvider(legacy: string | null, legacySecret: string | null): { profiles: string; secret: string | null } | null {
  if (!legacy) return null;
  try {
    const record = JSON.parse(legacy) as { version: 1; configuration: { provider: 'openai' | 'ollama'; model: string; tokenLimitField: 'max_tokens' | 'max_completion_tokens'; responseFormat: 'prompt' | 'json_object' | 'json_schema'; maxOutputTokens: number; storage: 'session' | 'persistent' } };
    const c = record.configuration;
    const profile = { id: 'default', name: c.provider === 'openai' ? 'OpenAI' : 'Ollama Cloud', provider: c.provider, model: c.model, tokenLimitField: c.tokenLimitField, responseFormat: c.responseFormat, maxOutputTokens: c.maxOutputTokens, storage: c.storage };
    return { profiles: JSON.stringify({ version: 1, active: 'default', profiles: [profile] }), secret: legacySecret };
  } catch { return null; }
}
