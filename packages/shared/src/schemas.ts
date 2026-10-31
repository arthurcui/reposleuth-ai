/** Defines validated request, report, event, and usage contracts shared by the API and UI. */
import { z } from 'zod';

export * from './briefing.js';

export const healthSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('reposleuth-api'),
  stage: z.literal('foundation'),
});

export type HealthResponse = z.infer<typeof healthSchema>;

const text = z.string().min(1).max(4000);
export const evidenceSchema = z.object({
  id: z.string().min(1).max(40),
  path: z.string().min(1).max(1024),
  commitSha: z.string().regex(/^[a-f0-9]{40}$/),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  quote: text,
});
export const investigationModes = {
  quick: {
    label: 'Quick',
    description: 'Trace the most likely path and report key uncertainty.',
    turns: 6,
    tools: 10,
    tokens: 50000,
    outputTokens: 2000,
    timeoutMs: 60000,
    costUsd: 0.02,
  },
  standard: {
    label: 'Standard',
    description: 'Trace the relevant path and assess an alternative cause.',
    turns: 12,
    tools: 24,
    tokens: 100000,
    outputTokens: 2000,
    timeoutMs: 120000,
    costUsd: 0.05,
  },
  deep: {
    label: 'Deep',
    description: 'Examine related paths, competing causes and counter-evidence.',
    turns: 24,
    tools: 48,
    tokens: 300000,
    outputTokens: 2000,
    timeoutMs: 300000,
    costUsd: 0.15,
  },
} as const;
export const investigationModeSchema = z.enum(['quick', 'standard', 'deep']);
export type InvestigationMode = z.infer<typeof investigationModeSchema>;
export const reasoningSummarySchema = z.object({
  assessment: text,
  alternatives: z
    .array(z.object({ explanation: text, evidenceIds: z.array(z.string()).max(20) }))
    .max(3),
  counterEvidence: z
    .array(z.object({ explanation: text, evidenceIds: z.array(z.string()).max(20) }))
    .max(3),
  evidenceIds: z.array(z.string()).max(20),
  limitations: text,
});
export const reportVerificationSchema = z.object({
  sourceCitations: z.enum(['validated', 'none']),
  diagnosis: z.literal('unverified'),
  runtime: z.literal('not_executed'),
  coverage: z.enum(['partial', 'generated', 'insufficient_evidence']),
  filesExamined: z.array(z.string().max(1024)).max(48),
  rangesExamined: z.number().int().nonnegative(),
});
export const reportSchema = z.object({
  verification: reportVerificationSchema.optional(),
  reasoningSummary: reasoningSummarySchema.optional(),
  summary: text,
  findings: z
    .array(
      z.object({
        title: text,
        explanation: text,
        kind: z.enum(['fact', 'hypothesis']),
        confidence: z.enum(['low', 'medium', 'high']),
        uncertainty: text,
        evidenceIds: z.array(z.string()).min(1).max(20),
      }),
    )
    .max(10),
  evidence: z.array(evidenceSchema).max(20),
  recommendations: z.array(text).max(10),
  testPlan: z.array(text).max(10),
  risks: z.array(text).max(10),
  unresolvedQuestions: z.array(text).max(10),
});
export const investigationRequestSchema = z
  .object({
    mode: investigationModeSchema.optional(),
    repository: z.string().trim().min(3).max(250),
    issueNumber: z.number().int().positive().optional(),
    question: z.string().trim().min(5).max(2000),
    modelSelection: z
      .object({ provider: z.enum(['openai', 'gemini']), model: z.string().min(1).max(150) })
      .strict()
      .optional(),
  })
  .strict();
export type InvestigationRequest = z.infer<typeof investigationRequestSchema>;
export type InvestigationReport = z.infer<typeof reportSchema>;
export type InvestigationStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'budget_exceeded'
  | 'cancelled'
  | 'timed_out'
  | 'interrupted';
export interface InvestigationUsage {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  reservedCostUsd: number;
  usageIncomplete: boolean;
}
export const investigationLimitsSchema = z.object({
  costUsd: z.number().positive(),
  timeoutMs: z.number().positive(),
  turns: z.number().positive(),
  tools: z.number().positive(),
  tokens: z.number().positive(),
  outputTokens: z.number().positive(),
});
export interface Investigation {
  limits?: z.infer<typeof investigationLimitsSchema>;
  provider?: 'openai' | 'gemini';
  id: string;
  request: InvestigationRequest;
  status: InvestigationStatus;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number;
  commitSha: string | null;
  report: InvestigationReport | null;
  errorCode: string | null;
  usage: InvestigationUsage;
  model: string;
}

export const modelCatalogSchema = z.object({
  models: z.array(
    z.object({
      provider: z.enum(['openai', 'gemini']),
      model: z.string(),
      selectable: z.boolean(),
      reason: z.string().nullable(),
      inputPerMillion: z.number().nullable(),
      outputPerMillion: z.number().nullable(),
    }),
  ),
  errors: z.array(z.object({ provider: z.enum(['openai', 'gemini']), message: z.string() })),
  defaultSelection: z.object({ provider: z.enum(['openai', 'gemini']), model: z.string() }),
});
export type ModelCatalog = z.infer<typeof modelCatalogSchema>;
export interface InvestigationEvent {
  id: number;
  investigationId: string;
  at: string;
  type: string;
  data: Record<string, unknown>;
}

export const investigationStatusSchema = z.enum([
  'queued',
  'running',
  'completed',
  'failed',
  'budget_exceeded',
  'cancelled',
  'timed_out',
  'interrupted',
]);
export const historyQuerySchema = z
  .object({
    q: z.string().trim().max(300).default(''),
    repository: z.string().trim().max(250).default(''),
    issueNumber: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
    model: z.string().trim().max(150).default(''),
    status: investigationStatusSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).max(1000000).default(0),
  })
  .strict();
export type HistoryQuery = z.infer<typeof historyQuerySchema>;
export const historyItemSchema = z.object({
  id: z.string(),
  request: investigationRequestSchema,
  status: investigationStatusSchema,
  createdAt: z.string(),
  model: z.string(),
  summary: z.string().nullable(),
  hasReport: z.boolean(),
});
export const historyPageSchema = z.object({
  models: z.array(z.string()).optional(),
  items: z.array(historyItemSchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
});
export type HistoryPage = z.infer<typeof historyPageSchema>;
