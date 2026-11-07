/**
 * L'appel à Claude, isolé ici pour être doublé dans les tests.
 *
 * Repli côté serveur activé (`fallbacks: "default"`) : si le modèle décline une
 * demande, l'API la rejoue sur un modèle de repli dans le même appel, plutôt
 * que de laisser l'artisan devant une réponse vide.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { Llm } from './agent';

export function anthropicLlm(apiKey: string): Llm {
  const client = new Anthropic({ apiKey, timeout: 180_000, maxRetries: 2 });
  return {
    create: (params) =>
      client.beta.messages.create({
        ...params,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      }),
  };
}
