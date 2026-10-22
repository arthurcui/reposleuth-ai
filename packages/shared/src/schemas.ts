import { z } from 'zod';

export const healthSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('reposleuth-api'),
  stage: z.literal('foundation'),
});

export type HealthResponse = z.infer<typeof healthSchema>;
