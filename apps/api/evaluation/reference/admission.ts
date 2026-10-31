/** Probes initial guided admission using a non-network model before any paid comparison. */
import { DEFAULT_LIMITS, emptyUsage, StopError } from '../../src/agents/budget.js';
import { investigateGuided } from '../../src/agents/guided.js';
import type { ProviderConfig } from '../../src/agents/provider.js';
import { corpusRepository } from './corpus.js';

export async function explorationAdmitted(
  question: string,
  provider: ProviderConfig,
  allowance: number,
) {
  let reporting = false;
  let admitted = false;
  try {
    await investigateGuided({
      repository: corpusRepository('admission', {}),
      request: { repository: 'fixtures/admission', question, mode: 'standard' },
      provider,
      limits: DEFAULT_LIMITS,
      usage: emptyUsage(),
      signal: new AbortController().signal,
      reserve: () => {},
      saveUsage: () => {},
      remainingBudget: () => allowance,
      emit: (type, data) => {
        if (type === 'phase' && data.phase === 'reporting') reporting = true;
      },
      model: {
        getResponse: () => {
          admitted = !reporting;
          throw new StopError('OFFLINE_ADMISSION_PROBE');
        },
        getStreamedResponse: () => {
          throw new Error('unused');
        },
      },
    });
  } catch {
    /* Deliberately stop before any model response or repository work. */
  }
  return admitted;
}
