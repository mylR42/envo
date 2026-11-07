/**
 * La boucle de l'assistante : Claude + les outils Interfast (MCP) + quatre
 * outils locaux (questions à choix, brouillon de devis, mémoire REX).
 *
 * Trois règles qui gouvernent tout le fichier :
 *
 * 1. ⚠️ AUCUNE ÉCRITURE DANS INTERFAST SANS L'ARTISAN. Un outil qui modifie
 *    (`isWriteTool`) n'est pas exécuté : la boucle s'arrête, la demande est
 *    gardée (`conversations.pending`) et l'écran montre « Valider / Refuser ».
 *    L'outil ne part qu'au « Valider », depuis le serveur, avec les arguments
 *    EXACTS qui ont été montrés — jamais une version que le modèle aurait
 *    réécrite entre-temps.
 *
 * 2. L'historique est en AJOUT SEUL : chaque message est gardé tel que l'API l'a
 *    rendu (blocs de réflexion compris) et rejoué tel quel. Le réécrire casserait
 *    le cache et invaliderait la réflexion du modèle.
 *
 * 3. Tous les `tool_use` d'une réponse reçoivent leurs `tool_result` dans UN
 *    SEUL message utilisateur, y compris quand l'un d'eux attendait l'artisan :
 *    les résultats déjà obtenus sont gardés dans `pending.done` en attendant.
 */
import type {
  BetaContentBlockParam,
  BetaMessage,
  BetaMessageParam,
  BetaTool,
  BetaToolResultBlockParam,
  MessageCreateParamsNonStreaming,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { isWriteTool, McpError, type McpClient, type McpTool } from './mcp';

export interface Llm {
  create(params: MessageCreateParamsNonStreaming): Promise<BetaMessage>;
}

/** Préfixe des outils Interfast vus par le modèle : ils se distinguent des outils locaux. */
export const IF_PREFIX = 'if_';
export const MAX_STEPS = 12;

export type Waiting =
  | { kind: 'choice'; toolUseId: string; question: string; options: string[]; multiple: boolean }
  | { kind: 'confirm'; toolUseId: string; tool: string; title: string; input: Record<string, unknown> };

export interface Pending {
  done: BetaToolResultBlockParam[];
  waiting: Waiting[];
}

export type ActionState = 'attente' | 'validee' | 'refusee' | 'echec';

export type Answer = { toolUseId: string; choice?: string; approved?: boolean };

export interface TurnDeps {
  llm: Llm;
  model: string;
  effort: 'low' | 'medium' | 'high';
  /** Null quand Interfast n'est pas configuré : l'assistante le sait et le dit. */
  mcp: McpClient | null;
  mcpTools: McpTool[];
  context: string;
  systemPrompt: string;
  history: BetaMessageParam[];
  pending: Pending | null;
  /** Mémorise un élément de REX ; rend son identifiant. */
  remember(kind: string, content: string, tags: string): Promise<void>;
  searchRex(query: string): Promise<{ kind: string; content: string; created_at: Date | string }[]>;
  logTool(tool: string, ok: boolean, ms: number): Promise<void>;
  /** Trace d'une écriture proposée puis tranchée (table `actions`). */
  recordAction(a: { toolUseId: string; tool: string; input: Record<string, unknown>; state: ActionState; result?: string }): Promise<void>;
  onStatus?(text: string): void;
}

export interface TurnResult {
  /** Messages à AJOUTER à l'historique, dans l'ordre. */
  appended: BetaMessageParam[];
  pending: Pending | null;
  /** Un devis a été créé dans Interfast pendant ce tour : résumé du résultat. */
  created: string | null;
  stop: string;
}

/* ---------------- Outils locaux ---------------- */

const LOCAL_TOOLS: BetaTool[] = [
  {
    name: 'proposer_choix',
    description:
      "Pose UNE question à l'artisan en lui proposant des réponses toutes prêtes (boutons à l'écran). À utiliser dès qu'il existe des réponses probables, tirées des devis passés, du REX ou du bon sens du métier. L'artisan peut aussi répondre autre chose. Attend sa réponse avant de continuer.",
    input_schema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'La question, courte.' },
        options: { type: 'array', items: { type: 'string' }, description: '2 à 6 réponses courtes, la plus probable en premier.' },
        multiple: { type: 'boolean', description: 'Vrai si plusieurs réponses peuvent être choisies ensemble.' },
      },
      required: ['question', 'options'],
      additionalProperties: false,
    },
  },
  {
    name: 'afficher_brouillon',
    description:
      "Affiche à l'artisan le brouillon de devis en cours (tableau propre à l'écran). À rappeler à chaque évolution. N'écrit RIEN dans Interfast.",
    input_schema: {
      type: 'object',
      properties: {
        titre: { type: 'string' },
        client: { type: 'string' },
        chantier: { type: 'string', description: 'Adresse ou description du chantier.' },
        lignes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              designation: { type: 'string' },
              quantite: { type: 'number' },
              unite: { type: 'string', description: 'u, h, m², ml, forfait…' },
              prix_unitaire_ht: { type: 'number' },
              tva: { type: 'number', description: 'Taux en %, ex. 10' },
              origine: { type: 'string', description: "D'où vient le prix : article Interfast, devis passé, REX, proposition." },
            },
            required: ['designation', 'quantite', 'prix_unitaire_ht'],
            additionalProperties: false,
          },
        },
        remarques: { type: 'string' },
      },
      required: ['titre', 'lignes'],
      additionalProperties: false,
    },
  },
  {
    name: 'memoriser',
    description:
      "Enregistre dans le REX une décision ou une préférence réutilisable de l'artisan (tarif, habitude, règle pour un client, présentation). Une phrase autonome, au présent. Elle te sera rappelée dans les prochaines séances.",
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['decision', 'preference', 'tarif', 'client', 'methode'] },
        contenu: { type: 'string' },
        mots_cles: { type: 'string', description: 'Quelques mots pour la retrouver, séparés par des virgules.' },
      },
      required: ['type', 'contenu'],
      additionalProperties: false,
    },
  },
  {
    name: 'rechercher_rex',
    description: "Cherche dans le REX de l'artisan les décisions et préférences passées liées à un sujet (client, type de travaux, matériau…).",
    input_schema: {
      type: 'object',
      properties: { requete: { type: 'string' } },
      required: ['requete'],
      additionalProperties: false,
    },
  },
];

const LOCAL_NAMES = new Set(LOCAL_TOOLS.map((t) => t.name));

/** Nom vu par le modèle pour un outil Interfast (64 caractères au plus). */
export const modelName = (mcpName: string) => `${IF_PREFIX}${mcpName}`.slice(0, 64);

/**
 * Outils donnés au modèle. ⚠️ Liste TRIÉE et stable : un ordre qui change d'un
 * tour à l'autre invaliderait le cache du préfixe à chaque requête.
 */
export function toolDefinitions(mcpTools: McpTool[]): BetaTool[] {
  const remote = [...mcpTools]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(
      (t): BetaTool => ({
        name: modelName(t.name),
        description: `${isWriteTool(t) ? '[MODIFIE Interfast — validé par l’artisan avant exécution] ' : '[Lecture Interfast] '}${t.description ?? t.title ?? t.name}`.slice(0, 4000),
        input_schema: { type: 'object', ...(t.inputSchema ?? {}) } as BetaTool['input_schema'],
      }),
    );
  const all = [...LOCAL_TOOLS, ...remote];
  // Le dernier outil porte le point de cache : outils + consigne fixe = préfixe mis en cache.
  const last = all[all.length - 1]!;
  all[all.length - 1] = { ...last, cache_control: { type: 'ephemeral' } };
  return all;
}

const humanTitle = (t: McpTool) => t.annotations?.title ?? t.title ?? t.name.replace(/[_-]+/g, ' ');

const result = (id: string, content: string, isError = false): BetaToolResultBlockParam => ({
  type: 'tool_result',
  tool_use_id: id,
  content,
  ...(isError ? { is_error: true } : {}),
});

/** Un devis vient-il d'être créé ? Le nom de l'outil le dit (création + devis). */
export const createsQuote = (name: string) => /(create|creer|add|ajout|new)/i.test(name) && /(devis|quote|estimat)/i.test(name);

/* ---------------- Un tour ---------------- */

export async function runTurn(deps: TurnDeps, input: { text?: string; answers?: Answer[] }): Promise<TurnResult> {
  const byModelName = new Map(deps.mcpTools.map((t) => [modelName(t.name), t]));
  const appended: BetaMessageParam[] = [];
  let created: string | null = null;
  const text = input.text?.trim() ?? '';

  async function callMcp(tool: McpTool, args: Record<string, unknown>, id: string): Promise<BetaToolResultBlockParam> {
    if (!deps.mcp) return result(id, 'Interfast n’est pas connecté : l’artisan doit renseigner l’URL du serveur MCP dans Paramètres.', true);
    const t0 = Date.now();
    deps.onStatus?.(`Interfast : ${humanTitle(tool)}…`);
    try {
      const r = await deps.mcp.callTool(tool.name, args);
      await deps.logTool(tool.name, !r.isError, Date.now() - t0);
      if (!r.isError && isWriteTool(tool) && createsQuote(tool.name)) created = r.text.slice(0, 300);
      return result(id, r.text, r.isError);
    } catch (e) {
      await deps.logTool(tool.name, false, Date.now() - t0);
      return result(id, e instanceof McpError ? e.message : `Erreur inattendue : ${(e as Error).message}`, true);
    }
  }

  /* 1. Le message de l'artisan : réponses aux demandes en attente, puis son texte. */
  const content: BetaContentBlockParam[] = [];
  if (deps.pending) {
    content.push(...deps.pending.done);
    let textUsed = false;
    for (const w of deps.pending.waiting) {
      const a = input.answers?.find((x) => x.toolUseId === w.toolUseId);
      if (w.kind === 'choice') {
        const v = a?.choice?.trim() || text;
        if (v && !a?.choice) textUsed = true;
        content.push(result(w.toolUseId, v ? `Réponse de l'artisan : ${v}` : "L'artisan n'a pas répondu à cette question."));
      } else if (a?.approved === true) {
        const tool = deps.mcpTools.find((t) => t.name === w.tool);
        const r = tool ? await callMcp(tool, w.input, w.toolUseId) : result(w.toolUseId, 'Outil Interfast introuvable (la liste a changé) : action non exécutée.', true);
        await deps.recordAction({ toolUseId: w.toolUseId, tool: w.tool, input: w.input, state: r.is_error ? 'echec' : 'validee', result: String(r.content ?? '').slice(0, 2000) });
        content.push(r);
      } else {
        await deps.recordAction({ toolUseId: w.toolUseId, tool: w.tool, input: w.input, state: 'refusee' });
        content.push(result(w.toolUseId, a?.approved === false ? "L'artisan a REFUSÉ cette action : elle n'a pas été exécutée." : "L'artisan n'a pas validé cette action : elle n'a pas été exécutée."));
      }
    }
    if (text && !textUsed) content.push({ type: 'text', text });
  } else {
    if (!text) throw new Error('message vide');
    content.push({ type: 'text', text });
  }
  appended.push({ role: 'user', content });

  /* 2. La boucle. */
  const tools = toolDefinitions(deps.mcpTools);
  const system = [
    { type: 'text' as const, text: deps.systemPrompt, cache_control: { type: 'ephemeral' as const } },
    { type: 'text' as const, text: deps.context },
  ];
  for (let step = 0; step < MAX_STEPS; step++) {
    deps.onStatus?.(step === 0 ? 'L’assistante réfléchit…' : 'L’assistante continue…');
    const res = await deps.llm.create({
      model: deps.model,
      max_tokens: 16000,
      system,
      tools,
      tool_choice: { type: 'auto' },
      output_config: { effort: deps.effort },
      // Le dernier message porte le second point de cache : l'historique se relit à prix réduit.
      cache_control: { type: 'ephemeral' },
      messages: [...deps.history, ...appended],
    });
    appended.push({ role: 'assistant', content: res.content as BetaContentBlockParam[] });
    if (res.stop_reason !== 'tool_use') return { appended, pending: null, created, stop: res.stop_reason ?? 'end_turn' };

    const done: BetaToolResultBlockParam[] = [];
    const waiting: Waiting[] = [];
    for (const b of res.content) {
      if (b.type !== 'tool_use') continue;
      const args = (b.input && typeof b.input === 'object' ? b.input : {}) as Record<string, unknown>;
      if (b.name === 'proposer_choix') {
        const options = Array.isArray(args.options) ? args.options.map(String).filter(Boolean).slice(0, 6) : [];
        waiting.push({ kind: 'choice', toolUseId: b.id, question: String(args.question ?? ''), options, multiple: args.multiple === true });
      } else if (b.name === 'afficher_brouillon') {
        done.push(result(b.id, 'Brouillon affiché à l’artisan.'));
      } else if (b.name === 'memoriser') {
        const contenu = String(args.contenu ?? '').trim().slice(0, 600);
        if (contenu) await deps.remember(String(args.type ?? 'decision'), contenu, String(args.mots_cles ?? '').slice(0, 200));
        done.push(result(b.id, contenu ? 'Mémorisé.' : 'Rien à mémoriser (contenu vide).', !contenu));
      } else if (b.name === 'rechercher_rex') {
        const found = await deps.searchRex(String(args.requete ?? ''));
        done.push(result(b.id, found.length ? found.map((r) => `- [${r.kind}, ${new Date(r.created_at).toISOString().slice(0, 10)}] ${r.content}`).join('\n') : 'Aucun élément du REX ne correspond.'));
      } else {
        const tool = byModelName.get(b.name);
        if (!tool) done.push(result(b.id, `Outil inconnu : ${b.name}`, true));
        else if (isWriteTool(tool)) {
          waiting.push({ kind: 'confirm', toolUseId: b.id, tool: tool.name, title: humanTitle(tool), input: args });
          await deps.recordAction({ toolUseId: b.id, tool: tool.name, input: args, state: 'attente' });
        }
        else done.push(await callMcp(tool, args, b.id));
      }
    }
    if (waiting.length) return { appended, pending: { done, waiting }, created, stop: 'waiting' };
    appended.push({ role: 'user', content: done });
  }
  // Trop d'étapes : on rend la main plutôt que de tourner sans fin, en laissant un historique valide.
  return { appended, pending: null, created, stop: 'max_steps' };
}

export { LOCAL_NAMES };
