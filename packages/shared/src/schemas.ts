import { z } from 'zod';

export const healthSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('reposleuth-api'),
  stage: z.literal('foundation'),
});

export type HealthResponse = z.infer<typeof healthSchema>;

const text = z.string().min(1).max(4000);
export const evidenceSchema = z.object({
  id: z.string().min(1).max(40), path: z.string().min(1).max(1024),
  commitSha: z.string().regex(/^[a-f0-9]{40}$/),
  startLine: z.number().int().positive(), endLine: z.number().int().positive(),
  quote: text,
});
export const reportSchema = z.object({
  summary: text,
  findings: z.array(z.object({
    title: text, explanation: text, kind: z.enum(['fact', 'hypothesis']),
    confidence: z.enum(['low', 'medium', 'high']), uncertainty: text,
    evidenceIds: z.array(z.string()).min(1).max(20),
  })).max(10),
  evidence: z.array(evidenceSchema).max(20),
  recommendations: z.array(text).max(10), testPlan: z.array(text).max(10),
  risks: z.array(text).max(10), unresolvedQuestions: z.array(text).max(10),
});
export const investigationRequestSchema = z.object({
  repository: z.string().trim().min(3).max(250),
  issueNumber: z.number().int().positive().optional(),
  question: z.string().trim().min(5).max(2000),
}).strict();
export type InvestigationRequest = z.infer<typeof investigationRequestSchema>;
export type InvestigationReport = z.infer<typeof reportSchema>;
export type InvestigationStatus = 'queued' | 'running' | 'completed' | 'failed' | 'budget_exceeded' | 'cancelled' | 'timed_out' | 'interrupted';
export interface InvestigationUsage {
  requests: number; inputTokens: number; outputTokens: number;
  estimatedCostUsd: number; reservedCostUsd: number; usageIncomplete: boolean;
}
export interface Investigation {
  id: string; request: InvestigationRequest; status: InvestigationStatus;
  createdAt: string; startedAt: string | null; finishedAt: string | null;
  durationMs: number; commitSha: string | null; report: InvestigationReport | null;
  errorCode: string | null; usage: InvestigationUsage; model: string;
}
export interface InvestigationEvent {
  id: number; investigationId: string; at: string; type: string;
  data: Record<string, unknown>;
}
