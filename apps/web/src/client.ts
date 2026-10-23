import { z } from 'zod';
import { investigationRequestSchema, reportSchema } from '@reposleuth/shared';

export const runSchema = z.object({
  id: z.string(), request: investigationRequestSchema,
  status: z.enum(['queued', 'running', 'completed', 'failed', 'budget_exceeded', 'cancelled', 'timed_out', 'interrupted']),
  createdAt: z.string(), startedAt: z.string().nullable(), finishedAt: z.string().nullable(),
  durationMs: z.number(), commitSha: z.string().nullable(), report: reportSchema.nullable(),
  errorCode: z.string().nullable(), model: z.string(),
  usage: z.object({ requests: z.number(), inputTokens: z.number(), outputTokens: z.number(), estimatedCostUsd: z.number(), reservedCostUsd: z.number(), usageIncomplete: z.boolean() }),
});
export const eventSchema = z.object({ id: z.number(), investigationId: z.string(), at: z.string(), type: z.string(), data: z.record(z.string(), z.unknown()) });
export const isActive = (status: string) => status === 'queued' || status === 'running';
export function errorMessage(code: string): string {
  const messages: Record<string, string> = {
    AGENT_NOT_CONFIGURED: 'Configure OPENAI_API_KEY on the local API server, then restart it.',
    OPENAI_QUOTA: 'OpenAI API credits are exhausted. Add credits or explore the free demo.',
    OPENAI_AUTH: 'The server’s OpenAI API key was rejected. Check its local configuration.',
    OPENAI_ACCESS: 'The configured OpenAI model is unavailable to this project.',
    OPENAI_RATE_LIMIT: 'OpenAI rate-limited this run. Try again later.',
    PROCESS_RESTARTED: 'The API restarted during this investigation. Start a new run to continue.',
    SERVICE_STOPPED: 'The API stopped before this investigation finished.',
    INVALID_EVIDENCE: 'Source references could not be validated. No report was published.',
    BUDGET_EXCEEDED: 'The investigation stopped at its configured budget limit.',
    NOT_FOUND: 'This investigation or GitHub resource was not found.',
    ISSUE_NOT_FOUND: 'The requested GitHub issue was not found or is inaccessible. Check the issue number and repository. No model request was made.',
    QUEUE_FULL: 'The investigation queue is full. Wait for a run to finish.',
    CANCELLED: 'The investigation was cancelled.',
    TIMEOUT: 'The investigation reached its time limit.',
  };
  return messages[code] ?? `Investigation stopped: ${code.replaceAll('_', ' ').toLowerCase()}.`;
}
export async function api(path: string, init?: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`/api/investigations${path}`, { ...init, signal: AbortSignal.timeout(10000) });
  } catch {
    throw new Error('Cannot reach the local API. Start both apps with npm run dev and check the API terminal.');
  }
  let body: unknown;
  try { body = await response.json(); }
  catch {
    throw new Error(`The local API returned an empty or invalid response (HTTP ${response.status}). Make sure the API is running; start both apps with npm run dev and check the API terminal.`);
  }
  if (!response.ok) {
    const error = z.object({ error: z.string() }).safeParse(body);
    throw new Error(error.success ? errorMessage(error.data.error) : 'The local API could not process this request.');
  }
  return body;
}
export function sourceUrl(repository: string, sha: string, path: string, start: number, end: number) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !/^[a-f0-9]{40}$/.test(sha) || path.includes('\\') ||
    path.split('/').some(part => !part || part === '.' || part === '..') || !Number.isInteger(start) || start < 1 || !Number.isInteger(end) || end < start) return null;
  return `https://github.com/${repository}/blob/${sha}/${path.split('/').map(encodeURIComponent).join('/')}#L${start}-L${end}`;
}
