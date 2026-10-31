/** Verifies walkthrough citation admission and Markdown export without paying a model. */
import { type Model, Usage } from '@openai/agents';
import { type Briefing, briefingMarkdown } from '@reposleuth/shared';
import { expect, it } from 'vitest';

import { GEMINI } from '../../src/agents/provider.js';
import { summarizeBriefing } from '../../src/onboarding/summarize.js';

const report: Briefing = {
  id: 'code',
  repository: 'owner/repo',
  commitSha: 'a'.repeat(40),
  scope: '',
  createdAt: '',
  status: 'completed',
  durationMs: 0,
  filesDiscovered: 2,
  filesRead: 2,
  languages: [],
  directories: [],
  packages: [],
  documents: [],
  manifests: [],
  readingOrder: [],
  testFiles: [],
  limitations: [],
  codeSources: ['src/main.ts', 'src/app.ts'].map((path) => ({
    path,
    startLine: 1,
    endLine: 2,
    text: 'source\nsource',
    complete: true,
    reason: 'Read the source',
  })),
  codeConnections: [{ from: 'src/main.ts', to: 'src/app.ts', line: 1, kind: 'relative import' }],
};
const summary = {
  sections: ['Purpose', 'Where to begin'].map((title) => ({
    title,
    text: 'Static source observations.',
    sources: ['src/main.ts'],
  })),
  uncertainties: [],
  codeWalkthrough: {
    title: 'Request entry',
    overview: 'A sampled route.',
    trigger: 'An incoming request reaches the entry.',
    result: 'The handler returns the response.',
    steps: report.codeSources!.map((s) => ({
      title: s.path,
      explanation: 'Inspect the linked implementation.',
      readingTip: 'Look at its exported entry.',
      sources: [{ path: s.path, startLine: 1, endLine: 2 }],
    })),
    limitations: ['Not executed.'],
  },
};
function model(value: unknown, raw = false): Model {
  return {
    getResponse: async () => ({
      usage: new Usage({ inputTokens: 100, outputTokens: 50 }),
      output: [
        {
          type: 'message',
          role: 'assistant',
          status: 'completed',
          content: [{ type: 'output_text', text: raw ? String(value) : JSON.stringify(value) }],
        },
      ],
    }),
    getStreamedResponse: () => {
      throw Error('unused');
    },
  };
}
it('accepts connected source-only briefings and exports exact pinned ranges', async () => {
  const result = await summarizeBriefing(report, model(summary), GEMINI, () => {});
  expect(result.summary?.codeWalkthrough?.steps).toHaveLength(2);
  const markdown = briefingMarkdown(result);
  expect(markdown).toContain('How this project works');
  expect(markdown).toContain(`/blob/${report.commitSha}/src/app.ts#L1-L2`);
  expect(markdown).toContain('Reading tip:');
});
it.each(['unread.ts', 'range', 'reversed'])(
  'rejects %s citations and retains source details',
  async (kind) => {
    const bad = structuredClone(summary);
    const cite = bad.codeWalkthrough.steps[1]!.sources[0]!;
    if (kind === 'unread.ts') cite.path = kind;
    if (kind === 'range') cite.endLine = 3;
    if (kind === 'reversed') {
      cite.startLine = 2;
      cite.endLine = 1;
    }
    const result = await summarizeBriefing(report, model(bad), GEMINI, () => {});
    expect(result.summary?.sections).toEqual(summary.sections);
    expect(result.summary?.codeWalkthrough).toBeUndefined();
    expect(result.walkthroughError).toContain('INVALID_CODE_CITATION');
    expect(result.codeSources).toEqual(report.codeSources);
  },
);
it('rejects a claimed connected flow between unrelated source files', async () => {
  const result = await summarizeBriefing(
    { ...report, codeConnections: [] },
    model(summary),
    GEMINI,
    () => {},
  );
  expect(result.walkthroughError).toContain('UNSUPPORTED_CODE_ROUTE');
});

it.each(['trigger', 'result'] as const)(
  'rejects a newly generated example missing its %s',
  async (field) => {
    const bad = structuredClone(summary);
    const value = { ...bad, codeWalkthrough: { ...bad.codeWalkthrough, [field]: undefined } };
    const result = await summarizeBriefing(report, model(value), GEMINI, () => {});
    expect(result.walkthroughError).toContain('INCOMPLETE_CODE_EXAMPLE');
    expect(result.codeSources).toEqual(report.codeSources);
  },
);

it('supplies explicit source line numbers, including non-one excerpt offsets', async () => {
  const delegate = model({ sections: summary.sections, uncertainties: [] });
  const numbered: Model = {
    ...delegate,
    getResponse: async (request) => {
      const input: unknown = JSON.parse(String(request.input));
      expect(input).toMatchObject({
        codeSources: [
          {
            path: 'src/main.ts',
            startLine: 9,
            lines: [
              { line: 9, text: 'source' },
              { line: 10, text: 'source' },
            ],
          },
          { path: 'src/app.ts' },
        ],
      });
      return delegate.getResponse(request);
    },
  };
  const result = await summarizeBriefing(
    {
      ...report,
      codeSources: report.codeSources!.map((s, i) =>
        i === 0 ? { ...s, startLine: 9, endLine: 10 } : s,
      ),
    },
    numbered,
    GEMINI,
    () => {},
  );
  expect(result.summary).toBeDefined();
  expect(result.summaryDiagnostics).toBeUndefined();
});

it('preserves a valid overview when the optional walkthrough has an invalid schema', async () => {
  const result = await summarizeBriefing(
    report,
    model({
      ...summary,
      codeWalkthrough: { ...summary.codeWalkthrough, steps: 'rejected-secret-marker' },
    }),
    GEMINI,
    () => {},
  );
  expect(result.summary?.sections).toEqual(summary.sections);
  expect(result.summary?.codeWalkthrough).toBeUndefined();
  expect(result.summaryDiagnostics).toMatchObject({
    stage: 'walkthrough-schema',
    code: 'INVALID_WALKTHROUGH_SCHEMA',
    issues: expect.arrayContaining([{ path: 'steps', code: 'invalid_type' }]),
  });
  expect(JSON.stringify(result)).not.toContain('rejected-secret-marker');
  const markdown = briefingMarkdown(result);
  expect(markdown).toContain('Walkthrough unavailable');
  expect(markdown).not.toContain('Request entry');
});

it('distinguishes insufficient citation count from disconnected citations', async () => {
  const single = structuredClone(summary);
  single.codeWalkthrough.steps[1]!.sources[0]!.path = 'src/main.ts';
  const a = await summarizeBriefing(report, model(single), GEMINI, () => {});
  const b = await summarizeBriefing(
    { ...report, codeConnections: [] },
    model(summary),
    GEMINI,
    () => {},
  );
  expect(a.summaryDiagnostics?.issues[0]?.code).toBe('fewer_than_two_distinct_files');
  expect(b.summaryDiagnostics?.issues[0]?.code).toBe('disconnected_source');
  expect(a.summary?.codeWalkthrough).toBeUndefined();
  expect(b.summary?.codeWalkthrough).toBeUndefined();
});

it('records malformed JSON separately without leaking raw text or keeping a stale report', async () => {
  const result = await summarizeBriefing(
    { ...report, summary },
    model('{rejected-secret-marker', true),
    GEMINI,
    () => {},
  );
  expect(result.summary).toBeUndefined();
  expect(result.summaryDiagnostics).toMatchObject({
    stage: 'json',
    code: 'INVALID_SUMMARY_JSON',
    responseChars: 23,
  });
  expect(result.summaryDiagnostics?.responseSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(result)).not.toContain('rejected-secret-marker');
  expect(result.modelUsage?.requests).toBe(1);
});

it('bounds diagnostic issues and distinguishes overview schema failure', async () => {
  const result = await summarizeBriefing(
    report,
    model({
      sections: Array.from({ length: 20 }, () => ({ title: 7, text: false, sources: [] })),
      uncertainties: [],
    }),
    GEMINI,
    () => {},
  );
  expect(result.summary).toBeUndefined();
  expect(result.summaryDiagnostics?.stage).toBe('overview-schema');
  expect(result.summaryDiagnostics?.issues.length).toBeLessThanOrEqual(8);
});

it('rejects oversized responses before JSON parsing', async () => {
  const result = await summarizeBriefing(report, model('x'.repeat(32001), true), GEMINI, () => {});
  expect(result.summaryDiagnostics).toMatchObject({
    stage: 'response',
    code: 'RESPONSE_TOO_LARGE',
    responseChars: 32001,
  });
  expect(result.summary).toBeUndefined();
});
