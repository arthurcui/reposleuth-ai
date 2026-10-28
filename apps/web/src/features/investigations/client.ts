/** Validates API responses and provides investigation requests, status helpers, and source links. */
import {
  investigationLimitsSchema,
  investigationRequestSchema,
  reportSchema,
} from '@reposleuth/shared';
import { z } from 'zod';

export const runSchema = z.object({
  limits: investigationLimitsSchema.optional(),
  provider: z.enum(['openai', 'gemini']).optional(),
  id: z.string(),
  request: investigationRequestSchema,
  status: z.enum([
    'queued',
    'running',
    'completed',
    'failed',
    'budget_exceeded',
    'cancelled',
    'timed_out',
    'interrupted',
  ]),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  durationMs: z.number(),
  commitSha: z.string().nullable(),
  report: reportSchema.nullable(),
  errorCode: z.string().nullable(),
  model: z.string(),
  usage: z.object({
    requests: z.number(),
    inputTokens: z.number(),
    outputTokens: z.number(),
    estimatedCostUsd: z.number(),
    reservedCostUsd: z.number(),
    usageIncomplete: z.boolean(),
  }),
});
export const eventSchema = z.object({
  id: z.number(),
  investigationId: z.string(),
  at: z.string(),
  type: z.string(),
  data: z.record(z.string(), z.unknown()),
});
export const isActive = (status: string) => status === 'queued' || status === 'running';
export function errorMessage(code: string): string {
  const messages: Record<string, string> = {
    MODEL_UNAVAILABLE:
      'This model is unavailable or not enabled for investigations. Load available models and choose an enabled model.',
    MODEL_DISCOVERY_UNAVAILABLE: 'Model discovery is unavailable on this server.',
    INVALID_HISTORY_QUERY: 'Check your history filters and use a positive whole issue number.',
    INVALID_REPOSITORY: 'Enter a public GitHub repository URL or owner/repository.',
    HISTORY_UNAVAILABLE: 'Investigation history is unavailable on this API server.',
    REPORT_NOT_AVAILABLE: 'This investigation has no validated report to export.',
    AGENT_NOT_CONFIGURED:
      'Configure LLM_PROVIDER and its server API key (OPENAI_API_KEY or GEMINI_API_KEY), then restart it.',
    GEMINI_AUTHENTICATION: 'The server’s Gemini API key was rejected. Check its configuration.',
    GEMINI_ACCESS: 'The configured Gemini model is unavailable to this project.',
    GEMINI_RATE_LIMIT:
      'Gemini quota or rate limit reached. Check Google AI Studio usage before retrying.',
    GEMINI_QUOTA: 'Gemini API quota is exhausted. Check Google AI Studio usage.',
    GEMINI_INVALID_REQUEST: 'Gemini rejected the model request. Check server compatibility.',
    OPENAI_QUOTA: 'OpenAI API credits are exhausted. Add credits or explore the free demo.',
    OPENAI_AUTHENTICATION:
      'The server’s OpenAI API key was rejected. Check its local configuration.',
    OPENAI_ACCESS: 'The configured OpenAI model is unavailable to this project.',
    OPENAI_RATE_LIMIT: 'OpenAI rate-limited this run. Try again later.',
    PROCESS_RESTARTED: 'The API restarted during this investigation. Start a new run to continue.',
    SERVICE_STOPPED: 'The API stopped before this investigation finished.',
    INVALID_EVIDENCE: 'Source references could not be validated. No report was published.',
    BUDGET_EXCEEDED:
      'The server’s persistent spending allowance could not reserve another model request. Starting another run does not reset this allowance.',
    INVALID_REPORT: 'The model returned an invalid report. No report was published.',
    INPUT_ESTIMATE_EXCEEDED:
      'The provider reported more input tokens than reserved. The investigation stopped to protect the remaining budget.',
    MODEL_REQUEST_FAILED:
      'The model request failed. Check provider availability before starting a new investigation.',
    USAGE_UNAVAILABLE:
      'The provider did not return usable token accounting. The run stopped to protect its budget.',
    INVESTIGATION_FAILED:
      'The investigation stopped unexpectedly. Check the recorded activity and server logs before starting a new run.',
    BUDGET_EXCEEDED_REQUESTS:
      'The model request limit was reached. Narrow the investigation to a specific issue or symptom.',
    BUDGET_EXCEEDED_CONTEXT:
      'The next request exceeded the conservative context allowance. Narrow the investigation scope.',
    BUDGET_EXCEEDED_TOKENS:
      'The token allowance was reached, including the conservative estimate for the next request. Displayed tokens count only completed requests.',
    BUDGET_EXCEEDED_COST:
      'The cost allowance was reached, including the reservation for the next request. Displayed cost counts reported usage only.',
    BUDGET_EXCEEDED_TOOLS:
      'The repository tool-call limit was reached. Narrow the investigation to a specific issue or symptom.',
    NOT_FOUND: 'This investigation or GitHub resource was not found.',
    ISSUE_NOT_FOUND:
      'The requested GitHub issue was not found or is inaccessible. Check the issue number and repository. No model request was made.',
    QUEUE_FULL: 'The investigation queue is full. Wait for a run to finish.',
    CANCELLED: 'The investigation was cancelled.',
    TIMEOUT: 'The investigation reached its time limit.',
  };
  return messages[code] ?? `Investigation stopped: ${code.replaceAll('_', ' ').toLowerCase()}.`;
}
export async function api(path: string, init?: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`/api/investigations${path}`, {
      ...init,
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new Error(
      'Cannot reach the local API. Start both apps with npm run dev and check the API terminal.',
    );
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(
      `The local API returned an empty or invalid response (HTTP ${response.status}). Make sure the API is running; start both apps with npm run dev and check the API terminal.`,
    );
  }
  if (!response.ok) {
    const error = z.object({ error: z.string() }).safeParse(body);
    throw new Error(
      error.success
        ? errorMessage(error.data.error)
        : 'The local API could not process this request.',
    );
  }
  return body;
}
export function sourceUrl(
  repository: string,
  sha: string,
  path: string,
  start: number,
  end: number,
) {
  if (
    !/^[\w.-]+\/[\w.-]+$/.test(repository) ||
    !/^[a-f0-9]{40}$/.test(sha) ||
    path.includes('\\') ||
    path.split('/').some((part) => !part || part === '.' || part === '..') ||
    !Number.isInteger(start) ||
    start < 1 ||
    !Number.isInteger(end) ||
    end < start
  )
    return null;
  return `https://github.com/${repository}/blob/${sha}/${path.split('/').map(encodeURIComponent).join('/')}#L${start}-L${end}`;
}
