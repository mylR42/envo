/**
 * Ce que l'écran montre d'une conversation, tiré de l'historique au format de
 * l'API et des actions d'écriture tranchées (table `actions`). PUR et testé :
 * l'écran ne lit jamais le format de l'API lui-même.
 */
import type { BetaMessageParam } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { IF_PREFIX, type ActionState, type Pending } from './agent';

export interface DraftLine {
  designation: string;
  quantite: number;
  unite?: string;
  prix_unitaire_ht: number;
  tva?: number;
  origine?: string;
}

export type ViewItem =
  | { type: 'user'; text: string }
  | { type: 'assistant'; text: string }
  | { type: 'answer'; text: string }
  | { type: 'choice'; id: string; question: string; options: string[]; multiple: boolean; open: boolean }
  | { type: 'draft'; titre: string; client?: string; chantier?: string; lignes: DraftLine[]; remarques?: string }
  | { type: 'lookup'; tool: string; ok: boolean | null }
  | { type: 'confirm'; id: string; tool: string; input: Record<string, unknown>; state: ActionState }
  | { type: 'memo'; text: string };

type Block = { type: string; [k: string]: unknown };

const blocks = (m: BetaMessageParam): Block[] => (typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : (m.content as unknown as Block[]));

const resultText = (b: Block): string => {
  const c = b.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((x) => String((x as Block).text ?? '')).join('\n');
  return '';
};

export function toView(history: BetaMessageParam[], pending: Pending | null, actions: Map<string, ActionState>): ViewItem[] {
  const out: ViewItem[] = [];
  const toolNames = new Map<string, string>();
  const lookups = new Map<string, Extract<ViewItem, { type: 'lookup' }>>();
  const waitingIds = new Set(pending?.waiting.map((w) => w.toolUseId) ?? []);

  for (const m of history) {
    for (const b of blocks(m)) {
      if (m.role === 'user') {
        if (b.type === 'text' && typeof b.text === 'string' && b.text.trim()) out.push({ type: 'user', text: b.text });
        if (b.type === 'tool_result') {
          const id = String(b.tool_use_id);
          if (toolNames.get(id) === 'proposer_choix') out.push({ type: 'answer', text: resultText(b).replace(/^Réponse de l'artisan : /, '') });
          const l = lookups.get(id);
          if (l) l.ok = b.is_error !== true;
        }
        continue;
      }
      if (b.type === 'text' && typeof b.text === 'string' && b.text.trim()) out.push({ type: 'assistant', text: b.text });
      if (b.type !== 'tool_use') continue;
      const id = String(b.id);
      const name = String(b.name);
      const input = (b.input ?? {}) as Record<string, unknown>;
      toolNames.set(id, name);
      if (name === 'proposer_choix') {
        out.push({
          type: 'choice',
          id,
          question: String(input.question ?? ''),
          options: Array.isArray(input.options) ? input.options.map(String) : [],
          multiple: input.multiple === true,
          open: waitingIds.has(id),
        });
      } else if (name === 'afficher_brouillon') {
        out.push({
          type: 'draft',
          titre: String(input.titre ?? 'Devis'),
          client: input.client ? String(input.client) : undefined,
          chantier: input.chantier ? String(input.chantier) : undefined,
          lignes: Array.isArray(input.lignes) ? (input.lignes as DraftLine[]) : [],
          remarques: input.remarques ? String(input.remarques) : undefined,
        });
      } else if (name === 'memoriser') {
        out.push({ type: 'memo', text: String(input.contenu ?? '') });
      } else if (name.startsWith(IF_PREFIX)) {
        const state = actions.get(id);
        if (state) out.push({ type: 'confirm', id, tool: name.slice(IF_PREFIX.length), input, state });
        else {
          const l: Extract<ViewItem, { type: 'lookup' }> = { type: 'lookup', tool: name.slice(IF_PREFIX.length), ok: null };
          lookups.set(id, l);
          out.push(l);
        }
      }
    }
  }
  return out;
}
