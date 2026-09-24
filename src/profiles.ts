import { z } from 'zod';
import type { OpenAICompatibleConfig } from '../shared/lib/review/openai-compatible';
import { destinationLabel, isPrivateHost } from '../shared/lib/review/openai-compatible';
import type { ReviewSettingsSource } from '../shared/lib/review/local-review-service';
import { parseStrictJson } from '../shared/lib/security/strict-json';
import { ENDPOINTS, KeySchema } from '../shared/lib/settings/provider-settings';
import type { KeyVault, SettingsPersistence } from '../shared/lib/settings/local-settings-store';

/**
 * Several named provider profiles, one active. OpenAI and Ollama Cloud keep
 * their fixed endpoints; "custom" takes any OpenAI-compatible base URL
 * (OpenRouter, a local server) so the plugin needs no provider list. A custom
 * URL must be https unless the host is loopback or a private-network address.
 * Keys never live in plugin data: one Secret Storage entry per profile, bound
 * to its destination, or session memory. Missing Secret Storage fails closed.
 */
export const DEFAULT_TIMEOUT_S = 40;
export const MAX_TIMEOUT_S = 300;
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const ProfileSchema = z.strictObject({
  id: z.string().regex(ID).max(40),
  name: z.string().min(1).max(60),
  provider: z.enum(['openai', 'ollama', 'custom']),
  baseURL: z.string().max(2048).optional(),
  model: z.string().min(1).max(120).regex(/^[\x21-\x7e]+$/),
  tokenLimitField: z.enum(['max_tokens', 'max_completion_tokens']),
  responseFormat: z.enum(['prompt', 'json_object', 'json_schema']),
  maxOutputTokens: z.number().int().min(256).max(8192),
  storage: z.enum(['session', 'persistent']),
  /** Seconds to wait for the provider; local models can be slow. */
  timeoutSeconds: z.number().int().min(5).max(MAX_TIMEOUT_S).default(DEFAULT_TIMEOUT_S),
}).refine(profile => profile.provider !== 'custom' || (profile.baseURL !== undefined && validateCustomURL(profile.baseURL) === null), { message: 'INVALID_BASE_URL' });
export type Profile = z.infer<typeof ProfileSchema>;
export const ProfilesRecordSchema = z.strictObject({ version: z.literal(1), active: z.string().nullable(), profiles: z.array(ProfileSchema).max(20) });
export type ProfilesRecord = z.infer<typeof ProfilesRecordSchema>;
const VaultSchema = z.strictObject({ version: z.literal(1), destination: z.string(), apiKey: KeySchema });

/** null when acceptable, otherwise a reason code. */
export function validateCustomURL(input: string): string | null {
  let url: URL;
  try { url = new URL(input.trim()); } catch { return 'INVALID_BASE_URL'; }
  if (url.username || url.password || url.search || url.hash || !url.hostname) return 'INVALID_BASE_URL';
  if (url.protocol === 'https:') return null;
  if (url.protocol === 'http:') return isPrivateHost(url.hostname) ? null : 'HTTPS_REQUIRED';
  return 'INVALID_BASE_URL';
}

export function destinationOf(profile: Pick<Profile, 'provider' | 'baseURL'>): string {
  if (profile.provider === 'custom') return (profile.baseURL ?? '').trim().replace(/\/+$/, '');
  return ENDPOINTS[profile.provider];
}
/** name · destination · model, without repeating the destination when the profile is simply named after it. */
export function profileLabel(profile: Pick<Profile, 'provider' | 'baseURL' | 'model' | 'name'>): string {
  const destination = destinationLabel(destinationOf(profile));
  const parts = profile.name.trim().toLowerCase() === destination.toLowerCase() ? [profile.name, profile.model] : [profile.name, destination, profile.model];
  return parts.join(' · ');
}
/** Non-secret identity of a dispatch configuration; equal fingerprints mean the same destination, model, and limits. */
export function profileFingerprint(profile: Profile): string {
  return JSON.stringify([profile.id, destinationOf(profile), profile.model, profile.tokenLimitField, profile.responseFormat, profile.maxOutputTokens, profile.timeoutSeconds]);
}

export function newProfileId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return `p-${Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')}`;
}

export class ProfileStore implements ReviewSettingsSource {
  private record: ProfilesRecord = { version: 1, active: null, profiles: [] };
  private sessionKeys = new Map<string, string>();
  constructor(private readonly disk: SettingsPersistence, private readonly vaultFor: (profileId: string) => KeyVault, private readonly secureAvailable: () => Promise<boolean>) {}

  async load(): Promise<void> {
    const raw = await this.disk.read();
    if (raw === null) return;
    try { this.record = ProfilesRecordSchema.parse(parseStrictJson(raw)); } catch { this.record = { version: 1, active: null, profiles: [] }; }
    if (this.record.active && !this.record.profiles.some(p => p.id === this.record.active)) this.record.active = null;
  }
  list(): readonly Profile[] { return this.record.profiles; }
  active(): Profile | null { return this.record.profiles.find(p => p.id === this.record.active) ?? null; }
  get(id: string): Profile | null { return this.record.profiles.find(p => p.id === id) ?? null; }
  secureStorageAvailable(): Promise<boolean> { return this.secureAvailable(); }

  /** Whether a key is known for this profile right now (vault or session). Never returns the key. */
  async hasKey(id: string): Promise<boolean> {
    if (this.sessionKeys.has(id)) return true;
    const profile = this.get(id);
    if (!profile || profile.storage !== 'persistent' || !(await this.secureAvailable())) return false;
    return (await this.readVaultKey(profile)) !== null;
  }

  async setActive(id: string | null): Promise<void> {
    if (id !== null && !this.get(id)) throw new Error('UNKNOWN_PROFILE');
    this.record = { ...this.record, active: id };
    await this.persist();
  }

  /** Create or update a profile. A new key replaces the old one; otherwise the existing key is kept if the destination is unchanged. */
  async save(input: unknown, apiKey?: string): Promise<Profile> {
    const parsed = ProfileSchema.safeParse(input);
    if (!parsed.success) {
      const baseURL = input !== null && typeof input === 'object' && 'baseURL' in input && typeof input.baseURL === 'string' ? input.baseURL : '';
      throw new Error(parsed.error.issues.some(i => i.message === 'INVALID_BASE_URL') ? (validateCustomURL(baseURL) ?? 'INVALID_BASE_URL') : 'INVALID_PROFILE');
    }
    const profile = parsed.data;
    const previous = this.get(profile.id);
    const destination = destinationOf(profile);
    let key = apiKey?.trim() || undefined;
    if (!key && previous && destinationOf(previous) === destination) key = this.sessionKeys.get(profile.id) ?? (previous.storage === 'persistent' ? (await this.readVaultKey(previous)) ?? undefined : undefined);
    if (!key) throw new Error('KEY_REQUIRED');
    if (!KeySchema.safeParse(key).success) throw new Error('INVALID_KEY');
    if (profile.storage === 'persistent') {
      if (!(await this.secureAvailable())) throw new Error('SECURE_STORAGE_UNAVAILABLE');
      await this.vaultFor(profile.id).write(JSON.stringify({ version: 1, destination, apiKey: key }));
      this.sessionKeys.delete(profile.id);
    } else {
      await this.vaultFor(profile.id).remove();
      this.sessionKeys.set(profile.id, key);
    }
    const profiles = previous ? this.record.profiles.map(p => (p.id === profile.id ? profile : p)) : [...this.record.profiles, profile];
    this.record = { version: 1, active: this.record.active ?? profile.id, profiles };
    await this.persist();
    return profile;
  }

  async remove(id: string): Promise<void> {
    if (!this.get(id)) return;
    await this.vaultFor(id).remove();
    this.sessionKeys.delete(id);
    this.record = { version: 1, active: this.record.active === id ? null : this.record.active, profiles: this.record.profiles.filter(p => p.id !== id) };
    await this.persist();
  }

  /**
   * A settings source bound to the profile the learner confirmed. Dispatch
   * resolves that exact profile by id and refuses if its destination, model,
   * or limits changed since confirmation, whatever the active profile is now.
   */
  bound(profileId: string, fingerprint: string): ReviewSettingsSource {
    return { snapshot: () => { const profile = this.get(profileId); if (!profile || profileFingerprint(profile) !== fingerprint) throw new Error('PROFILE_CHANGED'); return this.snapshotOf(profile); } };
  }

  /** The active profile's dispatch configuration, key included; only the review service calls this. */
  async snapshot(): Promise<OpenAICompatibleConfig> {
    const profile = this.active();
    if (!profile) throw new Error('SETTINGS_REQUIRED');
    return this.snapshotOf(profile);
  }

  private async snapshotOf(profile: Profile): Promise<OpenAICompatibleConfig> {
    // A persisted key is used only while encrypted storage is established; otherwise the learner re-enters it for the session.
    if (profile.storage === 'persistent' && !this.sessionKeys.has(profile.id) && !(await this.secureAvailable())) throw new Error('SECURE_STORAGE_UNAVAILABLE');
    const apiKey = this.sessionKeys.get(profile.id) ?? (profile.storage === 'persistent' ? await this.readVaultKey(profile) : null);
    if (!apiKey) throw new Error('KEY_REQUIRED');
    return { baseURL: destinationOf(profile), apiKey, model: profile.model, tokenLimitField: profile.tokenLimitField, responseFormat: profile.responseFormat, maxOutputTokens: profile.maxOutputTokens, timeoutMs: profile.timeoutSeconds * 1000, ...(profile.provider === 'custom' ? { allowPrivateHttp: true } : {}) };
  }

  private async readVaultKey(profile: Profile): Promise<string | null> {
    try {
      // Guard every reuse path, including edits and persistent-to-session conversion.
      if (!(await this.secureAvailable())) return null;
      const raw = await this.vaultFor(profile.id).read();
      if (raw === null) return null;
      const bound = VaultSchema.parse(parseStrictJson(raw));
      return bound.destination === destinationOf(profile) ? bound.apiKey : null;
    } catch { return null; }
  }
  private persist(): Promise<void> { return this.disk.write(JSON.stringify(this.record)); }
}
