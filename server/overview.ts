/**
 * Le tableau de bord INTERFAST : ce qui se passe dans l'entreprise (devis en
 * attente, à relancer, factures impayées, chiffre du mois, planning).
 *
 * Les noms des outils du MCP Interfast ne sont pas connus d'avance : une
 * collecte en LECTURE SEULE les choisit elle-même. Claude reçoit UNIQUEMENT les
 * outils de lecture (`!isWriteTool`) — un outil d'écriture n'est même pas
 * proposé, il ne peut donc pas être appelé — puis rend le résultat par l'outil
 * local `publier_tableau`, au schéma strict.
 *
 * Trois règles :
 * - ⚠️ AUCUN CHIFFRE INVENTÉ : chaque valeur vient d'une réponse d'Interfast ;
 *   ce qu'Interfast ne fournit pas est `null` (tiret à l'écran) et dit dans
 *   `manques`. `sanitize()` borne et nettoie ce qui revient du modèle.
 * - Rien n'est écrit en base (les données métier restent dans Interfast) : le
 *   résultat vit en MÉMOIRE, 30 minutes, par compte.
 * - Budget : 10 étapes au plus, effort `low` ; une collecte ratée le dit.
 */
import type { BetaContentBlockParam, BetaMessageParam, BetaTool, BetaToolResultBlockParam } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { modelName, type Llm } from './agent';
import { isWriteTool, McpError, type McpClient, type McpTool } from './mcp';

export const OVERVIEW_TTL_MS = 30 * 60_000;
export const OVERVIEW_MAX_STEPS = 10;

export interface Kpi {
  cle: string;
  libelle: string;
  valeur: number | null;
  unite: 'eur' | 'nombre' | 'pourcent';
  detail: string;
}
export interface QuoteRow {
  ref: string;
  client: string;
  objet: string;
  montant_ht: number | null;
  date: string;
  statut: string;
  jours: number | null;
}
export interface InvoiceRow {
  ref: string;
  client: string;
  montant_ttc: number | null;
  echeance: string;
  jours_retard: number | null;
}
export interface EventRow {
  date: string;
  client: string;
  objet: string;
}
export interface Overview {
  kpis: Kpi[];
  devis_a_relancer: QuoteRow[];
  derniers_devis: QuoteRow[];
  factures_impayees: InvoiceRow[];
  a_venir: EventRow[];
  manques: string[];
  sources: string[];
  resume: string;
}

const quoteSchema = {
  type: 'object',
  properties: {
    ref: { type: 'string' },
    client: { type: 'string' },
    objet: { type: 'string' },
    montant_ht: { type: ['number', 'null'] },
    date: { type: 'string', description: 'AAAA-MM-JJ' },
    statut: { type: 'string', description: 'en français : brouillon, envoyé, accepté, refusé…' },
    jours: { type: ['integer', 'null'], description: 'jours écoulés depuis l’envoi' },
  },
  required: ['ref', 'client', 'objet', 'montant_ht', 'date', 'statut', 'jours'],
  additionalProperties: false,
};

export const PUBLISH_TOOL: BetaTool = {
  name: 'publier_tableau',
  description: 'Publie le tableau de bord. À appeler UNE fois, à la fin, avec uniquement des valeurs lues dans les réponses d’Interfast.',
  input_schema: {
    type: 'object',
    properties: {
      kpis: {
        type: 'array',
        description: 'Indicateurs. Clés attendues : devis_en_attente (nombre), montant_devis_en_attente (eur HT), devis_acceptes_mois (nombre), taux_transformation (pourcent, sur 90 jours), ca_facture_mois (eur HT), factures_impayees (eur TTC). valeur = null si Interfast ne permet pas de la calculer.',
        items: {
          type: 'object',
          properties: {
            cle: { type: 'string' },
            libelle: { type: 'string' },
            valeur: { type: ['number', 'null'] },
            unite: { type: 'string', enum: ['eur', 'nombre', 'pourcent'] },
            detail: { type: 'string', description: 'une courte précision (période, nombre de pièces…), ou ""' },
          },
          required: ['cle', 'libelle', 'valeur', 'unite', 'detail'],
          additionalProperties: false,
        },
      },
      devis_a_relancer: { type: 'array', description: 'Devis envoyés sans réponse depuis 7 jours ou plus, les plus anciens d’abord (10 au plus).', items: quoteSchema },
      derniers_devis: { type: 'array', description: 'Les 8 derniers devis, tous statuts.', items: quoteSchema },
      factures_impayees: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            ref: { type: 'string' },
            client: { type: 'string' },
            montant_ttc: { type: ['number', 'null'] },
            echeance: { type: 'string', description: 'AAAA-MM-JJ ou ""' },
            jours_retard: { type: ['integer', 'null'] },
          },
          required: ['ref', 'client', 'montant_ttc', 'echeance', 'jours_retard'],
          additionalProperties: false,
        },
      },
      a_venir: {
        type: 'array',
        description: 'Interventions ou chantiers planifiés dans les 14 prochains jours.',
        items: {
          type: 'object',
          properties: { date: { type: 'string' }, client: { type: 'string' }, objet: { type: 'string' } },
          required: ['date', 'client', 'objet'],
          additionalProperties: false,
        },
      },
      manques: { type: 'array', items: { type: 'string' }, description: 'Ce qu’Interfast ne permet pas de savoir (une phrase par manque).' },
      resume: { type: 'string', description: 'Deux phrases au plus : ce qui demande l’attention de l’artisan aujourd’hui.' },
    },
    required: ['kpis', 'devis_a_relancer', 'derniers_devis', 'factures_impayees', 'a_venir', 'manques', 'resume'],
    additionalProperties: false,
  },
};

export function overviewPrompt(today: string): string {
  return `Tu prépares le tableau de bord d'un artisan du bâtiment à partir de son logiciel de gestion Interfast. Date du jour : ${today}.

Interroge Interfast avec les outils "if_" (tous en lecture) pour connaître : les devis (statut, montant, date d'envoi, client), les factures (payées ou non, échéance), et le planning des 14 prochains jours. Fais les appels nécessaires, en parallèle quand c'est possible, sans dépasser une dizaine d'appels.

RÈGLE ABSOLUE : chaque valeur publiée doit venir des réponses d'Interfast. N'invente jamais un chiffre, un client ou une référence. Si une information n'est pas disponible, mets null (ou une liste vide) et dis-le dans "manques". Tu peux faire des sommes et des comptes à partir des données lues.

Termine en appelant publier_tableau, une seule fois.`;
}

/* ---------------- Nettoyage de ce qui revient du modèle ---------------- */

const s = (v: unknown, max = 160) => String(v ?? '').trim().slice(0, max);
const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 1e10 ? v : null);
const arr = (v: unknown, max: number): unknown[] => (Array.isArray(v) ? v.slice(0, max) : []);
const quote = (q: Record<string, unknown>): QuoteRow => ({
  ref: s(q.ref, 60),
  client: s(q.client, 120),
  objet: s(q.objet),
  montant_ht: n(q.montant_ht),
  date: s(q.date, 20),
  statut: s(q.statut, 40),
  jours: n(q.jours),
});

/** Valide et borne le tableau publié. PUR, testé. */
export function sanitize(input: unknown, sources: string[]): Overview {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const units = new Set(['eur', 'nombre', 'pourcent']);
  return {
    kpis: arr(o.kpis, 12).map((k) => {
      const r = (k ?? {}) as Record<string, unknown>;
      return { cle: s(r.cle, 60), libelle: s(r.libelle, 80), valeur: n(r.valeur), unite: (units.has(String(r.unite)) ? r.unite : 'nombre') as Kpi['unite'], detail: s(r.detail, 120) };
    }).filter((k) => k.libelle),
    devis_a_relancer: arr(o.devis_a_relancer, 10).map((q) => quote((q ?? {}) as Record<string, unknown>)).filter((q) => q.ref || q.client),
    derniers_devis: arr(o.derniers_devis, 8).map((q) => quote((q ?? {}) as Record<string, unknown>)).filter((q) => q.ref || q.client),
    factures_impayees: arr(o.factures_impayees, 10)
      .map((f) => {
        const r = (f ?? {}) as Record<string, unknown>;
        return { ref: s(r.ref, 60), client: s(r.client, 120), montant_ttc: n(r.montant_ttc), echeance: s(r.echeance, 20), jours_retard: n(r.jours_retard) };
      })
      .filter((f) => f.ref || f.client),
    a_venir: arr(o.a_venir, 12)
      .map((e) => {
        const r = (e ?? {}) as Record<string, unknown>;
        return { date: s(r.date, 20), client: s(r.client, 120), objet: s(r.objet) };
      })
      .filter((e) => e.date || e.objet),
    manques: arr(o.manques, 8).map((m) => s(m, 200)).filter(Boolean),
    sources: [...new Set(sources)],
    resume: s(o.resume, 400),
  };
}

/* ---------------- La collecte ---------------- */

export interface CollectDeps {
  llm: Llm;
  model: string;
  mcp: McpClient;
  mcpTools: McpTool[];
  today: string;
  onStatus?(t: string): void;
  logTool(tool: string, ok: boolean, ms: number): Promise<void>;
}

export async function collectOverview(d: CollectDeps): Promise<Overview> {
  // ⚠️ Lecture seule : les outils d'écriture ne sont pas proposés.
  const readTools = d.mcpTools.filter((t) => !isWriteTool(t)).sort((a, b) => a.name.localeCompare(b.name));
  if (!readTools.length) throw new McpError('Interfast ne propose aucun outil de lecture : impossible de construire le tableau de bord.');
  const byName = new Map(readTools.map((t) => [modelName(t.name), t]));
  const tools: BetaTool[] = [
    ...readTools.map((t) => ({ name: modelName(t.name), description: (t.description ?? t.title ?? t.name).slice(0, 4000), input_schema: { type: 'object' as const, ...(t.inputSchema ?? {}) } })),
    PUBLISH_TOOL,
  ];
  const messages: BetaMessageParam[] = [{ role: 'user', content: 'Prépare mon tableau de bord.' }];
  const sources: string[] = [];
  for (let step = 0; step < OVERVIEW_MAX_STEPS; step++) {
    d.onStatus?.(step === 0 ? 'Lecture d’Interfast…' : 'Analyse des données…');
    const res = await d.llm.create({
      model: d.model,
      max_tokens: 16000,
      system: overviewPrompt(d.today),
      tools,
      tool_choice: { type: 'auto' },
      output_config: { effort: 'low' },
      messages,
    });
    messages.push({ role: 'assistant', content: res.content as BetaContentBlockParam[] });
    const uses = res.content.filter((b) => b.type === 'tool_use');
    const publish = uses.find((b) => b.name === PUBLISH_TOOL.name);
    if (publish) return sanitize(publish.input, sources);
    if (res.stop_reason !== 'tool_use' || !uses.length) break;
    const results: BetaToolResultBlockParam[] = [];
    await Promise.all(
      uses.map(async (b) => {
        const t = byName.get(b.name);
        if (!t) return void results.push({ type: 'tool_result', tool_use_id: b.id, content: `Outil indisponible : ${b.name}`, is_error: true });
        d.onStatus?.(`Interfast : ${t.annotations?.title ?? t.title ?? t.name}…`);
        const t0 = Date.now();
        try {
          const r = await d.mcp.callTool(t.name, (b.input && typeof b.input === 'object' ? b.input : {}) as Record<string, unknown>);
          await d.logTool(t.name, !r.isError, Date.now() - t0);
          if (!r.isError) sources.push(t.name);
          results.push({ type: 'tool_result', tool_use_id: b.id, content: r.text, ...(r.isError ? { is_error: true } : {}) });
        } catch (e) {
          await d.logTool(t.name, false, Date.now() - t0);
          results.push({ type: 'tool_result', tool_use_id: b.id, content: e instanceof McpError ? e.message : 'erreur', is_error: true });
        }
      }),
    );
    // Les résultats dans l'ordre des appels : un seul message utilisateur.
    const order = new Map(uses.map((b, i) => [b.id, i]));
    results.sort((a, b) => (order.get(a.tool_use_id) ?? 0) - (order.get(b.tool_use_id) ?? 0));
    messages.push({ role: 'user', content: results });
  }
  throw new Error('La collecte n’a pas abouti (trop d’étapes ou réponse incomplète).');
}
