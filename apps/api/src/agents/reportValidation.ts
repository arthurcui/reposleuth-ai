/** Validates report shape and exposes bounded diagnostics without persisting rejected content. */
import type { ModelResponse } from '@openai/agents';

import { draftReportSchema } from '../services/evidenceHandles.js';
import { StopError } from './budget.js';
import { reportDiagnostics, reportText } from './reportResponse.js';

export class ReportShapeError extends StopError {
  constructor(
    readonly diagnostic: {
      reason: 'INVALID_REPORT_JSON' | 'INVALID_REPORT_SCHEMA';
      fields?: { code: string; path: PropertyKey[] }[];
    },
  ) {
    super('INVALID_REPORT');
  }
}

export function validateReportShape(
  response: ModelResponse,
  emit: (type: string, data: Record<string, unknown>) => void,
) {
  const text = reportText(response);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    emit('validation_failed', {
      reason: 'INVALID_REPORT_JSON',
      characters: text.length,
      fenced: text.trimStart().startsWith('```'),
      endsObject: text.trimEnd().endsWith('}'),
      ...reportDiagnostics(response),
    });
    throw new ReportShapeError({ reason: 'INVALID_REPORT_JSON' });
  }
  const validated = draftReportSchema.safeParse(parsed);
  if (!validated.success) {
    const diagnostic = {
      reason: 'INVALID_REPORT_SCHEMA' as const,
      fields: validated.error.issues
        .slice(0, 20)
        .map((issue) => ({ code: issue.code, path: issue.path.slice(0, 8) })),
    };
    emit('validation_failed', diagnostic);
    throw new ReportShapeError(diagnostic);
  }
}
