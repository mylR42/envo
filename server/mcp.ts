/**
 * Client MCP minimal (transport « Streamable HTTP », JSON-RPC 2.0), écrit à la
 * main comme l'OAuth de Pixo : aucune dépendance, et un seul fichier à lire
 * quand Interfast change quelque chose.
 *
 * Interfast donne, dans la section « Clés API » du profil, l'URL d'un serveur
 * MCP PAR ENTREPRISE, sous la clé générée. Selon ce qu'Interfast affiche, la clé
 * est dans l'URL ou se passe à part : les deux sont acceptés (clé facultative,
 * envoyée en `Authorization: Bearer`).
 *
 * Trois points du protocole :
 * - la réponse à un POST est SOIT du JSON, SOIT un flux SSE (`text/event-stream`)
 *   dont un événement porte la réponse de même `id` : les deux sont lus ;
 * - `initialize` peut rendre un en-tête `Mcp-Session-Id`, renvoyé ensuite à
 *   chaque requête ; une session expirée (404) se rouvre une fois ;
 * - la liste des outils n'est PAS supposée : elle est lue (`tools/list`) et
 *   donnée telle quelle à l'assistante. Rien ici ne dépend d'un nom d'outil.
 */

export interface McpTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; title?: string };
}

export interface McpCallResult {
  text: string;
  isError: boolean;
}

export interface McpClient {
  listTools(): Promise<McpTool[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<McpCallResult>;
}

export class McpError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

const PROTOCOL = '2025-06-18';
const TIMEOUT_MS = 45_000;
/** Un résultat d'outil plus long n'aide pas l'assistante et coûte cher : il est coupé, et ça se dit. */
export const MAX_RESULT_CHARS = 60_000;

/** Lit un corps SSE et rend les messages JSON-RPC qu'il contient. */
export function parseSse(body: string): unknown[] {
  const out: unknown[] = [];
  for (const evt of body.split(/\r?\n\r?\n/)) {
    const data = evt
      .split(/\r?\n/)
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).replace(/^ /, ''))
      .join('\n');
    if (!data) continue;
    try {
      out.push(JSON.parse(data));
    } catch {
      /* événement non JSON (ping) : ignoré */
    }
  }
  return out;
}

/** Texte d'un résultat `tools/call` : blocs texte, sinon contenu structuré, sinon un résumé. */
export function resultText(result: unknown): McpCallResult {
  const r = (result ?? {}) as { content?: { type: string; text?: string; resource?: { text?: string } }[]; structuredContent?: unknown; isError?: boolean };
  const parts: string[] = [];
  for (const c of r.content ?? []) {
    if (c.type === 'text' && typeof c.text === 'string') parts.push(c.text);
    else if (c.type === 'resource' && typeof c.resource?.text === 'string') parts.push(c.resource.text);
    else parts.push(`[contenu ${c.type} non affiché]`);
  }
  if (!parts.length && r.structuredContent !== undefined) parts.push(JSON.stringify(r.structuredContent));
  let text = parts.join('\n') || '(réponse vide)';
  if (text.length > MAX_RESULT_CHARS) text = `${text.slice(0, MAX_RESULT_CHARS)}\n[… réponse tronquée à ${MAX_RESULT_CHARS} caractères]`;
  return { text, isError: r.isError === true };
}

export function mcpClient(opts: { url: string; apiKey?: string | null; fetchFn?: typeof fetch; clientName?: string }): McpClient {
  const fetchFn = opts.fetchFn ?? fetch;
  let sessionId: string | null = null;
  let ready: Promise<void> | null = null;
  let nextId = 1;

  async function post(body: Record<string, unknown>, expectReply: boolean): Promise<unknown> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': PROTOCOL,
    };
    if (opts.apiKey) headers.Authorization = `Bearer ${opts.apiKey}`;
    if (sessionId) headers['Mcp-Session-Id'] = sessionId;
    let res: Response;
    try {
      res = await fetchFn(opts.url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (e) {
      throw new McpError(`Interfast injoignable (${(e as Error).name === 'TimeoutError' ? 'délai dépassé' : (e as Error).message})`);
    }
    const sid = res.headers.get('mcp-session-id');
    if (sid) sessionId = sid;
    if (res.status === 401 || res.status === 403) throw new McpError('Interfast refuse la clé (401/403) : vérifiez-la dans Paramètres', res.status);
    if (!res.ok && res.status !== 202) throw new McpError(`Interfast a répondu ${res.status}`, res.status);
    if (!expectReply) return null;
    const type = res.headers.get('content-type') ?? '';
    const raw = await res.text();
    const messages = type.includes('text/event-stream') ? parseSse(raw) : [JSON.parse(raw || 'null')];
    const reply = messages.flat().find((m) => (m as { id?: unknown })?.id === body.id) as { result?: unknown; error?: { message?: string; code?: number } } | undefined;
    if (!reply) throw new McpError('Réponse MCP introuvable dans la réponse d’Interfast');
    if (reply.error) throw new McpError(`Interfast : ${reply.error.message ?? 'erreur'} (${reply.error.code ?? '?'})`);
    return reply.result;
  }

  const rpc = (method: string, params: Record<string, unknown> = {}) => post({ jsonrpc: '2.0', id: nextId++, method, params }, true);

  function init(): Promise<void> {
    ready ??= (async () => {
      await rpc('initialize', {
        protocolVersion: PROTOCOL,
        capabilities: {},
        clientInfo: { name: opts.clientName ?? 'envo', version: '0.1' },
      });
      await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, false);
    })().catch((e) => {
      ready = null;
      throw e;
    });
    return ready;
  }

  /** Une session expirée côté serveur (404) se rouvre une fois. */
  async function withSession<T>(fn: () => Promise<T>): Promise<T> {
    await init();
    try {
      return await fn();
    } catch (e) {
      if (e instanceof McpError && e.status === 404 && sessionId) {
        sessionId = null;
        ready = null;
        await init();
        return fn();
      }
      throw e;
    }
  }

  return {
    listTools: () =>
      withSession(async () => {
        const tools: McpTool[] = [];
        let cursor: string | undefined;
        for (let page = 0; page < 10; page++) {
          const r = (await rpc('tools/list', cursor ? { cursor } : {})) as { tools?: McpTool[]; nextCursor?: string };
          tools.push(...(r.tools ?? []));
          if (!r.nextCursor) break;
          cursor = r.nextCursor;
        }
        return tools.filter((t) => typeof t.name === 'string' && /^[a-zA-Z0-9_.-]{1,64}$/.test(t.name));
      }),
    callTool: (name, args) => withSession(async () => resultText(await rpc('tools/call', { name, arguments: args }))),
  };
}

/**
 * Un outil MODIFIE-t-il Interfast ? Si oui, l'assistante doit le faire valider
 * par l'artisan avant de l'appeler.
 *
 * L'annotation `readOnlyHint` du serveur fait foi quand elle existe. Sinon, le
 * nom décide — et dans le doute, c'est une écriture : une validation de trop
 * coûte un appui, un devis envoyé à tort coûte un client.
 */
export function isWriteTool(t: Pick<McpTool, 'name' | 'annotations'>): boolean {
  if (t.annotations?.readOnlyHint === true) return false;
  if (t.annotations?.readOnlyHint === false) return true;
  const n = t.name.toLowerCase();
  if (/(create|creer|add|ajout|update|modif|edit|delete|suppr|remove|send|envoi|envoy|set_|patch|post|archive|cancel|annul|valid|sign|convert|duplicate|dupliq)/.test(n)) return true;
  if (/(^|_|-)(get|list|search|find|read|fetch|show|count|lire|liste|cherch|recherch|consult|voir)/.test(n) || /^(get|list|search|find)/.test(n)) return false;
  return true;
}
