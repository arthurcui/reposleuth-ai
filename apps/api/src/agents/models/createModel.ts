/** Creates provider model adapters without coupling them to investigation orchestration. */
import { type Model, OpenAIChatCompletionsModel, OpenAIResponsesModel } from '@openai/agents';
import OpenAI from 'openai';

import { StopError } from '../budget.js';
import { OPENAI, type ProviderConfig } from '../provider.js';
export function liveModel(apiKey: string, config: ProviderConfig = OPENAI): Model {
  const client = new OpenAI({
    apiKey,
    baseURL:
      config.provider === 'gemini'
        ? 'https://generativelanguage.googleapis.com/v1beta/openai/'
        : 'https://api.openai.com/v1',
    maxRetries: 0,
    timeout: 30000,
  });
  if (config.provider !== 'gemini') return new OpenAIResponsesModel(client, config.model);
  const delegate = new OpenAIChatCompletionsModel(client, config.model);
  return {
    getResponse: (request) =>
      delegate.getResponse({
        ...request,
        // Use JSON-object mode with function tools; the strict JSON-schema request
        // is rejected by Gemini. The SDK still validates the final report schema.
        systemInstructions: `${request.systemInstructions ?? ''}\nWhen finished, return only JSON matching this schema:\n${JSON.stringify(request.outputType)}`,
        outputType: 'text',
        modelSettings: {
          ...request.modelSettings,
          providerData: {
            ...request.modelSettings.providerData,
            response_format: { type: 'json_object' },
          },
        },
      }),
    getStreamedResponse: () => {
      throw new StopError('STREAMING_MODEL_DISABLED');
    },
  };
}
