/**
 * Banc d'essai de l'API : vrai PostgreSQL en mémoire (PGlite), e-mail doublé,
 * Claude doublé (réponses écrites d'avance), Interfast doublé (un vrai serveur
 * MCP minuscule, interrogé par le VRAI client MCP). Aucun réseau.
 */
import { PGlite } from '@electric-sql/pglite';
import { Hono } from 'hono';
import type { BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { createApp } from '../../server/app';
import { loadConfig } from '../../server/config';
import { applySchema, type Db } from '../../server/db';
import type { Mail, Mailer } from '../../server/mail';
import { mcpClient } from '../../server/mcp';
import type { Llm } from '../../server/agent';

export const ORIGIN = 'https://envo.example.fr';
export const MCP_URL = 'https://mcp.interfast.test/v1/abc';

export function pgliteDb(pg: PGlite): Db {
  return {
    query: async <T>(sql: string, params: unknown[] = []) => (await pg.query<T>(sql, params)).rows,
    close: () => pg.close(),
  };
}

/** Faux serveur MCP Interfast : quelques outils, et la trace des appels reçus. */
export function fakeInterfast() {
  const calls: { name: string; args: Record<string, unknown>; auth: string | null }[] = [];
  const tools = [
    { name: 'search_customers', description: 'Cherche un client', inputSchema: { type: 'object', properties: { query: { type: 'string' } } } },
    { name: 'list_quotes', description: 'Liste les devis', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } },
    { name: 'create_quote', description: 'Crée un devis', inputSchema: { type: 'object', properties: { customer_id: { type: 'string' }, lines: { type: 'array' } } } },
  ];
  const srv = new Hono();
  srv.post('*', async (c) => {
    const auth = c.req.header('authorization') ?? null;
    if (auth !== 'Bearer cle-secrete') return c.text('refusé', 401);
    const msg = (await c.req.json()) as { id?: number; method: string; params?: { name?: string; arguments?: Record<string, unknown> } };
    if (msg.id === undefined) return c.body(null, 202);
    const reply = (result: unknown) => ({ jsonrpc: '2.0', id: msg.id, result });
    if (msg.method === 'initialize') {
      c.header('Mcp-Session-Id', 'sess-1');
      return c.json(reply({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'interfast', version: '1' } }));
    }
    if (c.req.header('mcp-session-id') !== 'sess-1') return c.text('session inconnue', 404);
    if (msg.method === 'tools/list') return c.json(reply({ tools }));
    if (msg.method === 'tools/call') {
      calls.push({ name: msg.params!.name!, args: msg.params!.arguments ?? {}, auth });
      const text =
        msg.params!.name === 'search_customers'
          ? JSON.stringify([{ id: 'c-42', name: 'Martin Dupont', city: 'Angers' }])
          : msg.params!.name === 'create_quote'
            ? JSON.stringify({ id: 'D-2026-0099', status: 'brouillon' })
            : JSON.stringify([{ id: 'D-2026-0012', title: 'Remplacement chauffe-eau', total_ht: 1450 }]);
      // Réponse en flux SSE, comme le permet le transport « Streamable HTTP ».
      return c.body(`event: message\ndata: ${JSON.stringify(reply({ content: [{ type: 'text', text }] }))}\n\n`, 200, { 'Content-Type': 'text/event-stream' });
    }
    return c.json({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'méthode inconnue' } });
  });
  const fetchFn = ((url: string, init: RequestInit) => srv.request(url, init)) as unknown as typeof fetch;
  return { calls, tools, fetchFn };
}

type Block = Record<string, unknown> & { type: string };

/** Faux Claude : rend les réponses dans l'ordre et garde les requêtes reçues. */
export function scriptedLlm(script: Block[][]) {
  const requests: Parameters<Llm['create']>[0][] = [];
  let i = 0;
  const llm: Llm = {
    create: async (p) => {
      requests.push(JSON.parse(JSON.stringify(p)));
      const content = script[i++] ?? [{ type: 'text', text: 'Fin du script.' }];
      return {
        id: `msg_${i}`,
        type: 'message',
        role: 'assistant',
        model: p.model,
        content,
        stop_reason: content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      } as unknown as BetaMessage;
    },
  };
  return { llm, requests, get calls() {
    return i;
  } };
}

export async function setup(opts: { script?: Block[][]; anthropic?: boolean } = {}) {
  const pg = new PGlite();
  const db = pgliteDb(pg);
  await applySchema(db);
  await applySchema(db); // idempotent
  const sent: Mail[] = [];
  const clock = { t: new Date('2026-11-07T09:00:00Z') };
  const mailer: Mailer = { enabled: true, send: async (m) => void sent.push(m) };
  const interfast = fakeInterfast();
  const scripted = scriptedLlm(opts.script ?? []);
  const env: Record<string, string> = { PUBLIC_URL: ORIGIN, ENVO_COMMIT: 'abc123', ENVO_SECRET_KEY: 'phrase-de-test' };
  if (opts.anthropic !== false) env.ANTHROPIC_API_KEY = 'sk-test';
  const cfg = loadConfig(env);
  const app = createApp({
    cfg,
    db,
    mailer,
    llm: opts.anthropic === false ? null : scripted.llm,
    mcpFactory: (url, apiKey) => mcpClient({ url, apiKey, fetchFn: interfast.fetchFn }),
    now: () => clock.t,
  });
  return { app, db, sent, clock, interfast, scripted };
}

export type App = Awaited<ReturnType<typeof setup>>['app'];

/** Petit client qui garde ses cookies, comme un navigateur. */
export function client(app: App) {
  let cookie = '';
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const h: Record<string, string> = { origin: ORIGIN, ...headers };
    if (cookie) h.cookie = cookie;
    if (body !== undefined) h['content-type'] = 'application/json';
    const res = await app.request(`${ORIGIN}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get('set-cookie');
    if (set) {
      const m = /envo_session=([^;]*)/.exec(set);
      if (m) cookie = m[1] ? `envo_session=${m[1]}` : '';
    }
    const type = res.headers.get('content-type') ?? '';
    const text = await res.text();
    let json: Record<string, unknown> = {};
    if (type.includes('text/event-stream')) {
      const events = text.split('\n\n').filter(Boolean).map((e) => ({
        event: /event: (.*)/.exec(e)?.[1] ?? '',
        data: e.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('\n'),
      }));
      const done = events.find((e) => e.event === 'done' || e.event === 'error');
      json = { ...(done ? JSON.parse(done.data) : {}), _events: events };
    } else if (text) json = JSON.parse(text);
    return { status: res.status, json: json as Record<string, any> };
  };
  return { call, get cookie() {
    return cookie;
  } };
}

/** Crée un compte (inscription + code) et rend un client connecté. */
export async function signedIn(env: Awaited<ReturnType<typeof setup>>, email = 'artisan@example.fr') {
  const c = client(env.app);
  await c.call('POST', '/api/auth/register', { email, password: 'motdepasse-solide', name: 'Paul Artisan' });
  const code = /(\d{6})/.exec(env.sent.at(-1)!.subject)![1];
  const r = await c.call('POST', '/api/auth/verify', { email, code });
  if (r.status !== 200) throw new Error(`inscription : ${JSON.stringify(r.json)}`);
  return c;
}
