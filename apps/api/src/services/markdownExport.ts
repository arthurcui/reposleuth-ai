/** Serializes a saved engineering report as portable Markdown without trusting embedded markup. */
import type { Investigation } from '@reposleuth/shared';

const text = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/([\\`*_{}[\]()#+.!|~-])/g, '\\$1');
const block = (value: string) => {
  const length = Math.max(3, ...[...value.matchAll(/`+/g)].map((match) => match[0].length + 1));
  const fence = '`'.repeat(length);
  return `${fence}text\n${value}\n${fence}`;
};

export function exportMarkdown(run: Investigation): string {
  if (!run.report) throw new Error('REPORT_NOT_AVAILABLE');
  const report = run.report;
  const lines = [
    '# Engineering investigation',
    '',
    `Repository: ${text(run.request.repository)}`,
    ...(run.request.issueNumber ? [`Issue: #${run.request.issueNumber}`] : []),
    `Investigation: ${text(run.id)}`,
    `Created: ${text(run.createdAt)}`,
    `Status: ${text(run.status)}`,
    `Model: ${text(run.model)}`,
    `Mode: ${run.request.mode ?? 'standard'}`,
    ...(run.limits
      ? [
          `Limits: ${run.limits.timeoutMs / 60000} minutes · $${run.limits.costUsd.toFixed(2)} estimated cost`,
        ]
      : []),
    `Pinned commit: ${text(run.commitSha ?? 'Unavailable')}`,
    `Duration: ${(run.durationMs / 1000).toFixed(1)} seconds`,
    `Usage: ${run.usage.inputTokens} input tokens · ${run.usage.outputTokens} output tokens · ${run.usage.requests} requests`,
    `Estimated cost: $${run.usage.estimatedCostUsd.toFixed(4)}`,
    ...(run.usage.usageIncomplete
      ? [`Usage incomplete; $${run.usage.reservedCostUsd.toFixed(4)} remains reserved.`]
      : []),
    '',
    '## Question',
    '',
    text(run.request.question),
    '',
    '## Summary',
    '',
    text(report.summary),
    '',
  ];
  if (report.reasoningSummary) {
    const reasoning = report.reasoningSummary;
    lines.push('## Evidence-based reasoning summary', '');
    for (const [heading, entries] of [
      ['Assessment', [{ explanation: reasoning.assessment, evidenceIds: reasoning.evidenceIds }]],
      ['Alternatives considered', reasoning.alternatives],
      ['Counter-evidence checked', reasoning.counterEvidence],
    ] as const) {
      lines.push(`### ${heading}`, '');
      if (!entries.length) lines.push('No assessment recorded.', '');
      for (const entry of entries)
        lines.push(
          text(entry.explanation),
          '',
          entry.evidenceIds.length
            ? `Evidence: ${entry.evidenceIds.map((id) => `#${report.evidence.findIndex((item) => item.id === id) + 1}`).join(', ')}`
            : 'Unverified · no source citation',
          '',
        );
    }
    lines.push(`Limitations: ${text(reasoning.limitations)}`, '');
  }
  lines.push('## Findings', '');
  for (const [index, finding] of report.findings.entries()) {
    lines.push(
      `### ${index + 1}. ${text(finding.title)}`,
      '',
      `${finding.kind} · Confidence: ${finding.confidence}`,
      '',
      text(finding.explanation),
      '',
      `Uncertainty: ${text(finding.uncertainty)}`,
      '',
      `Evidence: ${finding.evidenceIds.map((id) => `#${report.evidence.findIndex((e) => e.id === id) + 1}`).join(', ')}`,
      '',
    );
  }
  lines.push('## Evidence', '');
  for (const [index, evidence] of report.evidence.entries()) {
    lines.push(
      `### #${index + 1}: ${text(evidence.path)} (lines ${evidence.startLine}–${evidence.endLine})`,
      '',
      `Commit: ${text(evidence.commitSha)}`,
      '',
      block(evidence.quote),
      '',
    );
  }
  for (const [title, items] of [
    ['Proposed fixes', report.recommendations],
    ['Verification plan', report.testPlan],
    ['Risks', report.risks],
    ['Open questions', report.unresolvedQuestions],
  ] as const) {
    lines.push(
      `## ${title}`,
      '',
      ...(items.length ? items.flatMap((item) => [text(item), '']) : ['None recorded.', '']),
    );
  }
  lines.push(
    'Proposed fixes and verification steps have not been executed by this investigation.',
    '',
  );
  return lines.join('\n');
}
