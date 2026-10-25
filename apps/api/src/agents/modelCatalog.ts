/** Discovers account-visible models and gates selection on server-reviewed pricing and compatibility. */
import type { ModelCatalog } from '@reposleuth/shared';
import { z } from 'zod';

import { GEMINI, OPENAI, type ProviderConfig } from './provider.js';

const profileSchema = z.array(
  z
    .object({
      provider: z.enum(['openai', 'gemini']),
      model: z.string().regex(/^[\w.-]{1,150}$/),
      inputPerMillion: z.number().positive().max(10000),
      outputPerMillion: z.number().positive().max(10000),
    })
    .strict(),
);
export function modelProfiles(raw?: string): ProviderConfig[] {
  const profiles = [OPENAI, GEMINI];
  for (const entry of profileSchema.parse(raw ? JSON.parse(raw) : [])) {
    const base = entry.provider === 'openai' ? OPENAI : GEMINI;
    const profile = {
      ...base,
      model: entry.model,
      rates: { input: entry.inputPerMillion / 1e6, output: entry.outputPerMillion / 1e6 },
    };
    const index = profiles.findIndex(
      (p) => p.provider === entry.provider && p.model === entry.model,
    );
    if (index >= 0) profiles[index] = profile;
    else profiles.push(profile);
  }
  return profiles;
}

export class ModelCatalogService {
  private cached?: { until: number; value: ModelCatalog };
  private pending?: Promise<ModelCatalog>;
  constructor(
    private readonly keys: Partial<Record<'openai' | 'gemini', string>>,
    private readonly profiles: ProviderConfig[],
    private readonly defaultProvider: ProviderConfig,
    private readonly request: typeof fetch = fetch,
  ) {}
  list(): Promise<ModelCatalog> {
    if (this.cached && Date.now() < this.cached.until) return Promise.resolve(this.cached.value);
    if (this.pending) return this.pending;
    this.pending = this.discover()
      .then((value) => {
        this.cached = { value, until: Date.now() + (value.errors.length ? 30000 : 300000) };
        return value;
      })
      .finally(() => {
        this.pending = undefined;
      });
    return this.pending;
  }
  async resolve(selection: {
    provider: 'openai' | 'gemini';
    model: string;
  }): Promise<ProviderConfig> {
    const catalog = await this.list();
    if (
      !catalog.models.some(
        (m) => m.provider === selection.provider && m.model === selection.model && m.selectable,
      )
    )
      throw new Error('MODEL_UNAVAILABLE');
    return this.profiles.find(
      (p) => p.provider === selection.provider && p.model === selection.model,
    )!;
  }
  private async discover(): Promise<ModelCatalog> {
    const result: ModelCatalog = {
      models: [],
      errors: [],
      defaultSelection: {
        provider: this.defaultProvider.provider,
        model: this.defaultProvider.model,
      },
    };
    await Promise.all(
      (['openai', 'gemini'] as const).map(async (provider) => {
        const key = this.keys[provider];
        if (!key) return;
        try {
          const ids = new Set<string>();
          let token: string | undefined;
          const signal = AbortSignal.timeout(8000);
          for (let page = 0; page < 10; page++) {
            const url = new URL(
              provider === 'openai'
                ? 'https://api.openai.com/v1/models'
                : 'https://generativelanguage.googleapis.com/v1beta/models',
            );
            if (provider === 'gemini') {
              url.searchParams.set('pageSize', '1000');
              if (token) url.searchParams.set('pageToken', token);
            }
            const response = await this.request(url, {
              headers:
                provider === 'openai'
                  ? { Authorization: `Bearer ${key}` }
                  : { 'x-goog-api-key': key },
              signal,
              redirect: 'error',
            });
            if (!response.ok) throw new Error('DISCOVERY_FAILED');
            if (provider === 'openai') {
              const body = z
                .object({ data: z.array(z.object({ id: z.string().max(150) })) })
                .parse(await response.json());
              for (const model of body.data) ids.add(model.id);
              token = undefined;
            } else {
              const body = z
                .object({
                  models: z
                    .array(
                      z.object({
                        name: z.string(),
                        supportedGenerationMethods: z.array(z.string()).optional(),
                      }),
                    )
                    .default([]),
                  nextPageToken: z.string().optional(),
                })
                .parse(await response.json());
              for (const model of body.models)
                if (model.supportedGenerationMethods?.includes('generateContent'))
                  ids.add(model.name.replace(/^models\//, ''));
              token = body.nextPageToken;
            }
            if (!token) break;
          }
          if (token) throw new Error('DISCOVERY_TRUNCATED');
          for (const model of ids) {
            const profile = this.profiles.find((p) => p.provider === provider && p.model === model);
            result.models.push({
              provider,
              model,
              selectable: Boolean(profile),
              reason: profile
                ? null
                : 'Requires a server-reviewed tool compatibility and pricing profile.',
              inputPerMillion: profile ? profile.rates.input * 1e6 : null,
              outputPerMillion: profile ? profile.rates.output * 1e6 : null,
            });
          }
        } catch {
          result.errors.push({
            provider,
            message:
              'Could not discover models. Check server credentials, provider access, or connectivity; retry after 30 seconds.',
          });
        }
      }),
    );
    result.models.sort(
      (a, b) =>
        a.provider.localeCompare(b.provider) ||
        a.model.localeCompare(b.model, undefined, { numeric: true }),
    );
    return result;
  }
}
