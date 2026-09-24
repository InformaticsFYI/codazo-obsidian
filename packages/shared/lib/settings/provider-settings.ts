import { z } from 'zod';

/** Provider settings shared by every local application target. Only two fixed HTTPS destinations are approved. */
export const ENDPOINTS = { openai: 'https://api.openai.com/v1', ollama: 'https://ollama.com/v1' } as const;
export const ConfigurationSchema = z.strictObject({
  provider: z.enum(['openai', 'ollama']), model: z.string().min(1).max(120).regex(/^[\x21-\x7e]+$/),
  tokenLimitField: z.enum(['max_tokens', 'max_completion_tokens']), responseFormat: z.enum(['prompt', 'json_object', 'json_schema']),
  maxOutputTokens: z.number().int().min(256).max(8192), storage: z.enum(['session', 'persistent']),
});
export const KeySchema = z.string().min(1).max(8192).regex(/^[\x21-\x7e]+$/);
export const SaveSchema = ConfigurationSchema.extend({ apiKey: KeySchema.optional() });
export type Configuration = z.infer<typeof ConfigurationSchema>;
export type SaveSettings = Configuration & { apiKey?: string };
export type SettingsView = { configured: boolean; configuration: Configuration | null; secureStorageAvailable: boolean };

/** Human-readable provider label for review provenance; never includes the key. */
export function providerLabel(configuration: Pick<Configuration, 'provider'>): 'OpenAI' | 'Ollama Cloud' {
  return configuration.provider === 'openai' ? 'OpenAI' : 'Ollama Cloud';
}
