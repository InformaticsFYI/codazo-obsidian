import { z } from 'zod';
import { parseStrictJson } from '../security/strict-json';
import type { OpenAICompatibleConfig } from '../review/openai-compatible';
import { ConfigurationSchema, ENDPOINTS, KeySchema, SaveSchema } from './provider-settings';
import type { Configuration, SettingsView } from './provider-settings';

/** Platform secret storage (iOS Keychain, Android Keystore, Obsidian Secret Storage). Unavailable storage fails closed. */
export interface KeyVault {
  available(): Promise<boolean>;
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
  remove(): Promise<void>;
}
/** Plain configuration record on disk; it never contains the key. */
export interface SettingsPersistence {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
  remove(): Promise<void>;
}

/** Default provider deadline for local application targets. */
const REVIEW_TIMEOUT_MS = 40_000;

const RecordSchema = z.strictObject({ version: z.literal(1), configuration: ConfigurationSchema });
const VaultSchema = z.strictObject({ version: z.literal(1), destination: z.string(), apiKey: KeySchema });

/**
 * Provider settings for local application targets. Two fixed HTTPS destinations,
 * session-only or persistent storage, the key bound to its destination, and no
 * plaintext downgrade when secure storage is missing. The UI never reads the key
 * back; only the review dispatcher takes a snapshot.
 */
export class LocalSettingsStore {
  private current: { configuration: Configuration; apiKey: string } | null = null;
  constructor(private readonly disk: SettingsPersistence, private readonly vault: KeyVault) {}

  async view(): Promise<SettingsView> {
    return { configured: this.current !== null, configuration: this.current ? { ...this.current.configuration } : null, secureStorageAvailable: await this.vault.available() };
  }

  async load(): Promise<void> {
    try {
      const raw = await this.disk.read();
      if (raw === null) return;
      if (raw.length > 4000 || !(await this.vault.available())) throw new Error();
      const record = RecordSchema.parse(parseStrictJson(raw));
      if (record.configuration.storage !== 'persistent') throw new Error();
      const secret = await this.vault.read();
      if (secret === null) throw new Error();
      const bound = VaultSchema.parse(parseStrictJson(secret));
      if (bound.destination !== ENDPOINTS[record.configuration.provider]) throw new Error();
      this.current = { configuration: record.configuration, apiKey: bound.apiKey };
    } catch { throw new Error('SETTINGS_UNAVAILABLE'); }
  }

  async clear(): Promise<SettingsView> {
    await this.disk.remove();
    await this.vault.remove();
    this.current = null;
    return this.view();
  }

  async save(input: unknown): Promise<SettingsView> {
    const { apiKey, ...configuration } = SaveSchema.parse(input);
    const key = apiKey ?? (this.current?.configuration.provider === configuration.provider ? this.current.apiKey : undefined);
    if (!key) throw new Error('KEY_REQUIRED');
    if (configuration.storage === 'persistent') {
      if (!(await this.vault.available())) throw new Error('SECURE_STORAGE_UNAVAILABLE');
      await this.vault.write(JSON.stringify({ version: 1, destination: ENDPOINTS[configuration.provider], apiKey: key }));
      await this.disk.write(JSON.stringify({ version: 1, configuration }));
    } else {
      await this.disk.remove();
      await this.vault.remove();
    }
    this.current = { configuration, apiKey: key };
    return this.view();
  }

  async snapshot(): Promise<OpenAICompatibleConfig> {
    if (!this.current) throw new Error('SETTINGS_REQUIRED');
    const { configuration, apiKey } = this.current;
    return { baseURL: ENDPOINTS[configuration.provider], apiKey, model: configuration.model, tokenLimitField: configuration.tokenLimitField, responseFormat: configuration.responseFormat, maxOutputTokens: configuration.maxOutputTokens, timeoutMs: REVIEW_TIMEOUT_MS };
  }
}
