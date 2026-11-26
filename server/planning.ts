/**
 * Le PLANNING, lu dans Interfast (0.8.0) : interventions, chantiers, rendez-vous
 * et livraisons d'une période, par intervenant.
 *
 * Même méthode que le tableau de bord (server/overview.ts) : les noms d'outils
 * Interfast ne sont pas connus d'avance, une lecture par Claude les choisit
 * (outils de LECTURE seuls) et publie par l'outil local `publier_planning`.
 * ⚠️ Rien d'inventé, rien en base : le résultat vit en mémoire, par compte et
 * par période. Une MODIFICATION du planning passe par l'assistante (séance),
 * donc par « Valider », comme toute écriture dans Interfast.
 *
 * La recette (outils + arguments de la dernière lecture) est gardée avec les
 * dates REMPLACÉES par des repères (`{{debut}}`, `{{fin}}`) : rejouée pour une
 * autre semaine, elle lit la bonne période.
 */
import type { BetaTool } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { collectRead, type CollectDeps, type RecipeCall } from './overview';

export interface PlanEvent {
  ref: string;
  date: string;
  debut: string;
  fin: string;
  type: 'intervention' | 'chantier' | 'rdv' | 'livraison' | 'autre';
  objet: string;
  client: string;
  lieu: string;
  intervenants: string[];
  statut: string;
}

export interface Planning {
  du: string;
  au: string;
  evenements: PlanEvent[];
  intervenants: string[];
  manques: string[];
  sources: string[];
  resume: string;
}

export const PLAN_TYPES = ['intervention', 'chantier', 'rdv', 'livraison', 'autre'] as const;

export const PUBLISH_PLANNING: BetaTool = {
  name: 'publier_planning',
  description: 'Publie le planning de la période. À appeler UNE fois, à la fin, avec uniquement ce qu’Interfast a rendu.',
  input_schema: {
    type: 'object',
    properties: {
      evenements: {
        type: 'array',
        description: 'Tout ce qui est planifié sur la période, dans l’ordre chronologique (200 au plus).',
        items: {
          type: 'object',
          properties: {
            ref: { type: 'string', description: 'Identifiant ou référence Interfast de l’événement, ou "".' },
            date: { type: 'string', description: 'AAAA-MM-JJ' },
            debut: { type: 'string', description: 'HH:MM, ou "" si journée entière / inconnu' },
            fin: { type: 'string', description: 'HH:MM, ou ""' },
            type: { type: 'string', enum: [...PLAN_TYPES] },
            objet: { type: 'string', description: 'Ce qui est fait (pose chaudière, visite technique…).' },
            client: { type: 'string' },
            lieu: { type: 'string', description: 'Chantier ou adresse, ou "".' },
            intervenants: { type: 'array', items: { type: 'string' }, description: 'Noms des personnes ou équipes affectées.' },
            statut: { type: 'string', description: 'en français (planifié, confirmé, terminé, annulé…), ou "".' },
          },
          required: ['ref', 'date', 'debut', 'fin', 'type', 'objet', 'client', 'lieu', 'intervenants', 'statut'],
          additionalProperties: false,
        },
      },
      intervenants: { type: 'array', items: { type: 'string' }, description: 'L’équipe connue d’Interfast (même sans événement sur la période).' },
      manques: { type: 'array', items: { type: 'string' }, description: 'Ce qu’Interfast ne permet pas de savoir (une phrase par manque).' },
      resume: { type: 'string', description: 'Une phrase : la charge de la période, ce qui demande l’attention (conflit, journée vide, personne non affectée).' },
    },
    required: ['evenements', 'intervenants', 'manques', 'resume'],
    additionalProperties: false,
  },
};

export function planningPrompt(du: string, au: string, today: string): string {
  return `Tu lis le planning d'une entreprise du bâtiment dans son logiciel de gestion Interfast. Date du jour : ${today}. Période demandée : du ${du} au ${au} inclus.

Interroge Interfast avec les outils "if_" (tous en lecture) : planning, agenda, interventions, rendez-vous, chantiers planifiés, livraisons, et la liste des intervenants (salariés, équipes). Fais les appels nécessaires, en parallèle quand c'est possible, sans dépasser une dizaine d'appels. Passe la période aux outils qui l'acceptent.

RÈGLE ABSOLUE : tout ce que tu publies vient des réponses d'Interfast. N'invente jamais un événement, un horaire, un client ou un intervenant. Ce qu'Interfast ne fournit pas est "" (ou une liste vide), et dit dans "manques". Ne publie que les événements de la période.

Termine en appelant publier_planning, une seule fois.`;
}

/* ---------------- Nettoyage ---------------- */

const s = (v: unknown, max = 160) => String(v ?? '').trim().slice(0, max);
const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(`${v}T12:00:00Z`).getTime());
const hhmm = (v: unknown) => {
  const m = /^(\d{1,2})[:h](\d{2})/.exec(s(v, 8));
  if (!m) return '';
  const h = Number(m[1]);
  const mi = Number(m[2]);
  return h < 24 && mi < 60 ? `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}` : '';
};

/** Valide et borne le planning publié ; écarte ce qui sort de la période. PUR, testé. */
export function sanitizePlanning(input: unknown, sources: string[], du: string, au: string): Planning {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const list = (v: unknown, max: number) => (Array.isArray(v) ? v.slice(0, max) : []);
  const names = (v: unknown) => [...new Set(list(v, 30).map((x) => s(x, 80)).filter(Boolean))];
  const types = new Set<string>(PLAN_TYPES);
  const evenements = list(o.evenements, 200)
    .map((e) => {
      const r = (e && typeof e === 'object' ? e : {}) as Record<string, unknown>;
      const date = s(r.date, 10);
      return {
        ref: s(r.ref, 60),
        date,
        debut: hhmm(r.debut),
        fin: hhmm(r.fin),
        type: (types.has(s(r.type, 20)) ? s(r.type, 20) : 'autre') as PlanEvent['type'],
        objet: s(r.objet),
        client: s(r.client, 120),
        lieu: s(r.lieu, 200),
        intervenants: names(r.intervenants).slice(0, 8),
        statut: s(r.statut, 40),
      };
    })
    .filter((e) => isDay(e.date) && e.date >= du && e.date <= au && (e.objet || e.client))
    .sort((a, b) => (a.date + (a.debut || '99')).localeCompare(b.date + (b.debut || '99')));
  const team = names(o.intervenants);
  for (const e of evenements) for (const p of e.intervenants) if (!team.includes(p)) team.push(p);
  return {
    du,
    au,
    evenements,
    intervenants: team.slice(0, 40),
    manques: list(o.manques, 8).map((m) => s(m, 200)).filter(Boolean),
    sources: [...new Set(sources)],
    resume: s(o.resume, 300),
  };
}

/* ---------------- Période et recette ---------------- */

/** Lundi de la semaine d'une date (AAAA-MM-JJ). PUR. */
export function mondayOf(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  const wd = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - wd);
  return d.toISOString().slice(0, 10);
}

export const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Dates de la période → repères, pour garder une recette valable d'une semaine à l'autre. PUR, testé. */
export function templateArgs(v: unknown, du: string, au: string): unknown {
  if (typeof v === 'string') return v.split(du).join('{{debut}}').split(au).join('{{fin}}');
  if (Array.isArray(v)) return v.map((x) => templateArgs(x, du, au));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, templateArgs(x, du, au)]));
  return v;
}

/** Repères → dates de la période lue. PUR, testé. */
export function fillArgs(v: unknown, du: string, au: string): unknown {
  if (typeof v === 'string') return v.split('{{debut}}').join(du).split('{{fin}}').join(au);
  if (Array.isArray(v)) return v.map((x) => fillArgs(x, du, au));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fillArgs(x, du, au)]));
  return v;
}

export async function collectPlanning(d: CollectDeps, du: string, au: string): Promise<{ planning: Planning; recipe: RecipeCall[] }> {
  const recipe = (d.recipe ?? []).map((c) => ({ tool: c.tool, args: fillArgs(c.args, du, au) as Record<string, unknown> }));
  const r = await collectRead(
    { ...d, recipe },
    {
      system: planningPrompt(du, au, d.today),
      publish: PUBLISH_PLANNING,
      sanitize: (input, sources) => sanitizePlanning(input, sources, du, au),
      intro: `Lis mon planning du ${du} au ${au}.`,
      replayNote: 'Voici les réponses d’Interfast aux appels qui ont servi la dernière fois, faits à l’instant pour cette période. Si elles suffisent, publie directement ; sinon, complète.',
    },
  );
  return { planning: r.data, recipe: r.recipe.map((c) => ({ tool: c.tool, args: templateArgs(c.args, du, au) as Record<string, unknown> })) };
}
