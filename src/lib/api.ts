/** Appels à l'API d'Envo (même origine, cookie de session HttpOnly). */

export interface User {
  id: string;
  email: string;
  name: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('Pas de connexion au serveur. Vérifiez le réseau.', 0);
  }
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new ApiError(json.error ?? `Erreur ${res.status}`, res.status);
  return json;
}

export const api = {
  get: <T>(p: string) => call<T>('GET', p),
  post: <T>(p: string, b?: unknown) => call<T>('POST', p, b ?? {}),
  put: <T>(p: string, b: unknown) => call<T>('PUT', p, b),
  patch: <T>(p: string, b: unknown) => call<T>('PATCH', p, b),
  del: <T>(p: string) => call<T>('DELETE', p),
};

/* ---------- Types partagés avec le serveur (server/view.ts) ---------- */

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
  | { type: 'confirm'; id: string; tool: string; input: Record<string, unknown>; state: 'attente' | 'validee' | 'refusee' | 'echec' }
  | { type: 'memo'; text: string };

export interface ConvView {
  conversation: { id: string; title: string; status: string; kind: string; rating: number | null; outcome: string; updated_at: string };
  items: ViewItem[];
  waiting: { id: string; kind: 'choice' | 'confirm' }[];
  stop?: string;
  mcpNote?: string;
}

export interface ConvSummary {
  id: string;
  title: string;
  status: string;
  outcome: string;
  waiting: boolean;
  updated_at: string;
}

export type Answer = { toolUseId: string; choice?: string; approved?: boolean };

/**
 * POST dont la réponse arrive en flux (SSE) : des « status » pendant le travail,
 * puis « done » (le résultat) ou « error ». Les lignes « : ping » sont ignorées.
 */
export async function streamPost<T>(path: string, body: unknown, onStatus: (s: string) => void, cutMsg: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError('Pas de connexion au serveur.', 0);
  }
  if (!res.ok || !res.body) {
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(j.error ?? `Erreur ${res.status}`, res.status);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const evt = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const name = /^event: (.*)$/m.exec(evt)?.[1];
      if (!name) continue;
      const data = evt
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).replace(/^ /, ''))
        .join('\n');
      if (name === 'status') onStatus(data);
      else if (name === 'done') return JSON.parse(data) as T;
      else if (name === 'error') throw new ApiError((JSON.parse(data) as { error: string }).error, 500);
    }
    if (done) break;
  }
  throw new ApiError(cutMsg, 0);
}

/** Un tour de l'assistante. */
export const sendTurn = (convId: string, body: { text?: string; answers?: Answer[] }, onStatus: (s: string) => void) =>
  streamPost<ConvView>(`/api/conversations/${convId}/turn`, body, onStatus, 'La réponse a été coupée. Rechargez la séance : le travail fait est enregistré.');

/* ---------- Interfast : état et tableau de bord ---------- */

/** Suivi d'une lecture d'Interfast (server/app.ts, tâche de fond). */
export interface ReadJob {
  state: 'en_cours' | 'fini' | 'erreur';
  phase: 'interfast' | 'calcul';
  elapsedMs: number;
  estimateMs: number | null;
  calls: { id: number; label: string; state: 'en_cours' | 'ok' | 'erreur'; ms?: number }[];
  calcMs: number;
  error?: string;
}

export interface InterfastStatus {
  lastRead?: { ms: number; interfast_ms: number; calcul_ms: number; calls: number; at: string } | null;
  configured: boolean;
  ok: boolean;
  error?: string;
  host: string;
  keyHint: string;
  latencyMs?: number;
  checkedAt?: string;
  tools?: { name: string; write: boolean }[];
  week: { calls: number; errors: number; avg_ms: number | null; last_ok: string | null; last_error: string | null; top: { tool: string; n: number }[] };
}

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
export interface Overview {
  series: {
    ca_mensuel: { mois: string; montant_ht: number | null }[];
    devis_mensuels: { mois: string; en_attente: number | null; acceptes: number | null; refuses: number | null }[];
    pipeline: { statut: string; nombre: number | null; montant_ht: number | null }[];
    impayes_anciennete: { tranche: string; nombre: number | null; montant_ttc: number | null }[];
  };
  kpis: Kpi[];
  devis_a_relancer: QuoteRow[];
  derniers_devis: QuoteRow[];
  factures_impayees: { ref: string; client: string; montant_ttc: number | null; echeance: string; jours_retard: number | null }[];
  a_venir: { date: string; client: string; objet: string }[];
  manques: string[];
  sources: string[];
  resume: string;
}
