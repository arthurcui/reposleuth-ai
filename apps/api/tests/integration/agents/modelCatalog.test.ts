/** Verifies model discovery, failure isolation, pricing gates, and per-run provider selection. */
import { describe, expect, it, vi } from 'vitest';

import { ModelCatalogService, modelProfiles } from '../../../src/agents/modelCatalog.js';
import { GEMINI, OPENAI } from '../../../src/agents/provider.js';
import { buildApp } from '../../../src/app.js';
import { InvestigationService } from '../../../src/services/investigationService.js';
import { InvestigationStore } from '../../../src/storage/sqlite.js';
import { fakeRepository, ScriptedModel } from '../../fixtures/agentFixtures.js';

const response = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
describe('model catalog', () => {
  it('discovers both providers, paginates Gemini, caches, and disables unreviewed models', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ data: [{ id: OPENAI.model }, { id: 'unknown-model' }] }))
      .mockResolvedValueOnce(
        response({
          models: [
            { name: `models/${GEMINI.model}`, supportedGenerationMethods: ['generateContent'] },
          ],
          nextPageToken: 'next',
        }),
      )
      .mockResolvedValueOnce(
        response({
          models: [{ name: 'models/embedding', supportedGenerationMethods: ['embedContent'] }],
        }),
      );
    const catalog = new ModelCatalogService(
      { openai: 'fake', gemini: 'fake' },
      modelProfiles(),
      OPENAI,
      request,
    );
    const listed = await catalog.list();
    expect(listed.models).toHaveLength(3);
    expect(listed.models.find((m) => m.model === 'unknown-model')).toMatchObject({
      selectable: false,
      inputPerMillion: null,
    });
    expect((await catalog.resolve({ provider: 'gemini', model: GEMINI.model })).rates).toEqual(
      GEMINI.rates,
    );
    await expect(catalog.resolve({ provider: 'openai', model: 'unknown-model' })).rejects.toThrow(
      'MODEL_UNAVAILABLE',
    );
    expect(request).toHaveBeenCalledTimes(3);
    expect(String(request.mock.calls[2]![0])).toContain('pageToken=next');
  });
  it('does not expose credentials or upstream errors and preserves the healthy provider', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error('sensitive-key'))
      .mockResolvedValueOnce(
        response({
          models: [
            { name: `models/${GEMINI.model}`, supportedGenerationMethods: ['generateContent'] },
          ],
        }),
      );
    const catalog = new ModelCatalogService(
      { openai: 'secret', gemini: 'secret' },
      modelProfiles(),
      OPENAI,
      request,
    );
    const listed = await catalog.list();
    expect(listed.errors).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toMatch(/secret|sensitive-key/);
    expect(listed.models[0]?.selectable).toBe(true);
  });
  it('validates configurable profiles and never calls unconfigured providers', async () => {
    expect(() =>
      modelProfiles(
        '[{"provider":"openai","model":"x","inputPerMillion":-1,"outputPerMillion":1}]',
      ),
    ).toThrow();
    const profiles = modelProfiles(
      '[{"provider":"openai","model":"reviewed-model","inputPerMillion":1,"outputPerMillion":2}]',
    );
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response({ data: [{ id: 'reviewed-model' }] }));
    const catalog = new ModelCatalogService({ openai: 'fake' }, profiles, OPENAI, request);
    expect(
      (await catalog.resolve({ provider: 'openai', model: 'reviewed-model' })).rates.output,
    ).toBe(2e-6);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('validates selection before queueing and keeps selected provider and model in the run', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      response({
        models: [
          { name: `models/${GEMINI.model}`, supportedGenerationMethods: ['generateContent'] },
        ],
      }),
    );
    const catalog = new ModelCatalogService({ gemini: 'fake' }, modelProfiles(), GEMINI, request);
    const factory = vi.fn(() => new ScriptedModel());
    const store = new InvestigationStore(':memory:');
    const service = new InvestigationService(store, async () => fakeRepository(), factory);
    const app = buildApp(service, { catalog });
    try {
      const payload = {
        repository: 'owner/repo',
        question: 'Investigate the slow endpoint',
        modelSelection: { provider: 'gemini', model: GEMINI.model },
      };
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/investigations',
            payload: { ...payload, modelSelection: { provider: 'gemini', model: 'missing' } },
          })
        ).statusCode,
      ).toBe(400);
      expect(factory).not.toHaveBeenCalled();
      const created = await app.inject({ method: 'POST', url: '/api/investigations', payload });
      expect(created.statusCode).toBe(202);
      for (let i = 0; i < 100 && !factory.mock.calls.length; i++)
        await new Promise((resolve) => setTimeout(resolve, 5));
      expect(factory).toHaveBeenCalledWith(GEMINI);
      expect(store.get(created.json().id)).toMatchObject({
        provider: 'gemini',
        model: GEMINI.model,
        request: { modelSelection: payload.modelSelection },
      });
    } finally {
      await app.close();
    }
  });
});
