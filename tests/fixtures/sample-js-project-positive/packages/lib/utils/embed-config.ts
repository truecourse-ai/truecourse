import { z } from 'zod';

const EmbedColorScheme = { LIGHT: 'light', DARK: 'dark', SYSTEM: 'system' } as const;
const EmbedLanguage = { EN: 'en', DE: 'de', FR: 'fr', ES: 'es' } as const;

const EmbedConfigSchema = z.object({
  widgetId: z.string().uuid(),
  colorScheme: z.nativeEnum(EmbedColorScheme).default(EmbedColorScheme.SYSTEM),
  language: z.nativeEnum(EmbedLanguage).default(EmbedLanguage.EN),
  redirectUrl: z.string().url().optional(),
  hideHeader: z.boolean().default(false),
  hideFooter: z.boolean().default(false),
  allowedOrigins: z.array(z.string()).default([]),
  maxWidth: z.number().int().positive().optional(),
  borderRadius: z.number().int().min(0).max(24).default(8),
});

export type EmbedConfig = z.infer<typeof EmbedConfigSchema>;

export function parseEmbedConfig(raw: unknown): EmbedConfig {
  return EmbedConfigSchema.parse(raw);
}

export function safeParseEmbedConfig(raw: unknown): EmbedConfig | null {
  const result = EmbedConfigSchema.safeParse(raw);
  if (!result.success) {
    return null;
  }
  return result.data;
}

export function embedConfigToQueryString(config: EmbedConfig): string {
  const params = new URLSearchParams();
  params.set('widgetId', config.widgetId);
  params.set('colorScheme', config.colorScheme);
  params.set('language', config.language);
  if (config.redirectUrl) params.set('redirectUrl', config.redirectUrl);
  if (config.hideHeader) params.set('hideHeader', '1');
  if (config.hideFooter) params.set('hideFooter', '1');
  if (config.maxWidth) params.set('maxWidth', String(config.maxWidth));
  params.set('borderRadius', String(config.borderRadius));
  return params.toString();
}
