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
 * Un tour de l'assistante : la réponse arrive en flux (SSE) — des « status »
 * pendant qu'elle travaille, puis « done » avec la conversation à jour.
 */
export async function sendTurn(convId: string, body: { text?: string; answers?: Answer[] }, onStatus: (s: string) => void): Promise<ConvView> {
  let res: Response;
  try {
    res = await fetch(`/api/conversations/${convId}/turn`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError('Pas de connexion au serveur. Votre message n’est pas parti.', 0);
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
      const name = /^event: (.*)$/m.exec(evt)?.[1] ?? 'message';
      const data = evt
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).replace(/^ /, ''))
        .join('\n');
      if (name === 'status') onStatus(data);
      else if (name === 'done') return JSON.parse(data) as ConvView;
      else if (name === 'error') throw new ApiError((JSON.parse(data) as { error: string }).error, 500);
    }
    if (done) break;
  }
  throw new ApiError('La réponse a été coupée. Rechargez la séance : le travail fait est enregistré.', 0);
}
