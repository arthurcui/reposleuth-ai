/** Verifies complete Markdown reports and safe handling of embedded source and markup. */
import { expect, it } from 'vitest';
import { exportMarkdown } from '../../../src/services/markdownExport.js';
import { savedInvestigation } from '../../fixtures/savedInvestigation.js';

it('includes findings, evidence, fixes, uncertainty and usage in the download', () => {
  const run = savedInvestigation();
  const markdown = exportMarkdown(run);
  for (const heading of [
    'Summary',
    'Findings',
    'Evidence',
    'Proposed fixes',
    'Verification plan',
    'Risks',
    'Open questions',
  ])
    expect(markdown).toContain(`## ${heading}`);
  expect(markdown).toContain('Issue: #42');
  expect(markdown).toContain('Confidence: low');
  expect(markdown).toContain('200 input tokens');
  expect(markdown).toContain('Estimated cost: $0.0010');
  expect(markdown).toContain(run.commitSha);
});
it('escapes markup and keeps source fence delimiters inside the quote', () => {
  const run = savedInvestigation();
  run.report!.summary = '<script>alert(1)</script> [click](javascript:bad)';
  run.report!.evidence[0]!.quote = '```\n<script>source</script>\n```';
  run.usage.usageIncomplete = true;
  expect(exportMarkdown(run)).toContain('&lt;script&gt;');
  expect(exportMarkdown(run)).toContain('\\[click\\]');
  expect(exportMarkdown(run)).toContain('````text\n```\n<script>source</script>\n```\n````');
  expect(exportMarkdown(run)).toContain('Usage incomplete');
  expect(() => exportMarkdown(savedInvestigation({ report: null }))).toThrow(
    'REPORT_NOT_AVAILABLE',
  );
});
