/** Retains bounded discovery facts independently of model-authored plans and recent tool chatter. */
import { z } from 'zod';

const resultSchema = z.object({
  items: z.array(z.string().max(1024)).max(500),
  truncated: z.boolean(),
});
export class DiscoveryState {
  private omittedQueries = 0;
  private queries = new Map<
    string,
    {
      tool: string;
      arguments: Record<string, unknown>;
      paths: string[];
      truncated: boolean;
      attempts: number;
    }
  >();
  record(tool: string, args: Record<string, unknown>, value: unknown) {
    if (tool !== 'find_files' && tool !== 'list_files') return;
    const parsed = resultSchema.safeParse(value);
    if (!parsed.success) return;
    const key = JSON.stringify([tool, args]);
    const prior = this.queries.get(key);
    this.queries.delete(key);
    this.queries.set(key, {
      tool,
      arguments: args,
      paths: parsed.data.items.slice(0, 12),
      truncated: parsed.data.truncated || parsed.data.items.length > 12,
      attempts: (prior?.attempts ?? 0) + 1,
    });
    while (
      this.queries.size > 8 ||
      Buffer.byteLength(JSON.stringify([...this.queries.values()])) > 6000
    ) {
      this.queries.delete(this.queries.keys().next().value!);
      this.omittedQueries++;
    }
  }
  snapshot() {
    return { queries: [...this.queries.values()], omittedQueries: this.omittedQueries };
  }
}
