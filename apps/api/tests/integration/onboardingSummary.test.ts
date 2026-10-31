/** Verifies real adapter summary serialization, source validation and conservative failure handling without network. */
import { Usage } from '@openai/agents';
import type { Briefing } from '@reposleuth/shared';
import { afterEach, expect, it, vi } from 'vitest';

import { liveModel } from '../../src/agents/models/createModel.js';
import { GEMINI } from '../../src/agents/provider.js';
import { summarizeBriefing } from '../../src/onboarding/summarize.js';

const report: Briefing = {
  id: 'test',
  createdAt: '2026-10-30',
  repository: 'owner/repo',
  scope: '',
  commitSha: 'a'.repeat(40),
  status: 'completed',
  durationMs: 0,
  filesDiscovered: 1,
  filesRead: 1,
  languages: [],
  directories: [],
  packages: [],
  documents: [
    {
      path: 'README.md',
      startLine: 1,
      endLine: 1,
      text: 'A project for tracking orders.',
      complete: true,
    },
  ],
  manifests: [],
  readingOrder: [],
  testFiles: [],
  limitations: [],
};
const summary = {
  sections: [
    {
      title: 'Purpose',
      text: 'The documentation describes order tracking.',
      sources: ['README.md'],
    },
    { title: 'Start reading', text: 'Begin with the project README.', sources: ['README.md'] },
  ],
  uncertainties: ['Setup was not executed.'],
};
afterEach(() => vi.unstubAllGlobals());
it('keeps the Gemini summary contract instead of adding exploration instructions', async () => {
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    expect(JSON.stringify(body.messages)).not.toContain('exploration is complete');
    expect(body.tools ?? []).toEqual([]);
    expect(JSON.stringify(body.messages)).toContain('minItems');
    expect(JSON.stringify(body.messages)).toContain('required');
    return Response.json({
      id: 'test',
      object: 'chat.completion',
      created: 1,
      model: GEMINI.model,
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: { role: 'assistant', content: JSON.stringify(summary) },
        },
      ],
      usage: { prompt_tokens: 300, completion_tokens: 100, total_tokens: 400 },
    });
  });
  vi.stubGlobal('fetch', fetch);
  const output = await summarizeBriefing(report, liveModel('test-only', GEMINI), GEMINI, () => {});
  expect(output.summary).toEqual(summary);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(output.modelUsage?.usageIncomplete).toBe(false);
});

it.each([1, 0])(
  'retains a substantive single-section overview but rejects empty sections (%s)',
  async (count) => {
    const value = { ...summary, sections: summary.sections.slice(0, count) };
    const output = await summarizeBriefing(
      report,
      {
        getResponse: async () => ({
          usage: new Usage({ inputTokens: 100, outputTokens: 100 }),
          output: [
            {
              type: 'message',
              role: 'assistant',
              status: 'completed',
              content: [{ type: 'output_text', text: JSON.stringify(value) }],
            },
          ],
        }),
        getStreamedResponse: () => {
          throw Error('unused');
        },
      },
      GEMINI,
      () => {},
    );
    if (count) {
      expect(output.summary?.sections).toEqual(value.sections);
      expect(output.summaryError).toBeUndefined();
    } else {
      expect(output.summary).toBeUndefined();
      expect(output.summaryDiagnostics?.stage).toBe('overview-schema');
    }
  },
);
it('rejects invented sources while preserving source facts and billed usage', async () => {
  const output = await summarizeBriefing(
    report,
    {
      getResponse: async () => ({
        usage: new Usage({ inputTokens: 100, outputTokens: 100 }),
        output: [
          {
            type: 'message',
            role: 'assistant',
            status: 'completed',
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  ...summary,
                  sections: summary.sections.map((s) => ({ ...s, sources: ['unread.ts'] })),
                }),
              },
            ],
          },
        ],
      }),
      getStreamedResponse: () => {
        throw Error('unused');
      },
    },
    GEMINI,
    () => {},
  );
  expect(output.summary).toBeUndefined();
  expect(output.summaryError).toContain('UNKNOWN_SUMMARY_SOURCE');
  expect(output.documents).toEqual(report.documents);
  expect(output.modelUsage?.inputTokens).toBe(100);
});
it('does not call the model when the persistent budget rejects the reservation', async () => {
  const getResponse = vi.fn();
  const result = await summarizeBriefing(
    report,
    {
      getResponse,
      getStreamedResponse: () => {
        throw Error('unused');
      },
    },
    GEMINI,
    () => {
      throw Error('budget');
    },
  );
  expect(getResponse).not.toHaveBeenCalled();
  expect(result.summaryError).toBeTruthy();
});
