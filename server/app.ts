/**
 * L'API d'Envo : comptes (double authentification par code e-mail), réglages,
 * REX, conversations avec l'assistante, tableau de bord.
 *
 * Toutes les dépendances (base, e-mail, Claude, Interfast, horloge) sont
 * INJECTÉES : les tests exercent la vraie application sur PGlite, sans réseau.
 *
 * Règles de sécurité tenues ici (reprises de Pixo) :
 * - session = jeton aléatoire en cookie HttpOnly ; seul son SHA-256 est en base ;
 * - toute écriture exige une ORIGINE égale à PUBLIC_URL (anti-CSRF) ;
 * - inscription, connexion et « mot de passe oublié » répondent PAREIL qu'une
 *   adresse soit connue ou non ; la connexion coûte le même calcul (hash factice) ;
 * - toute lecture et écriture est filtrée par `user_id`, jamais par simple identifiant ;
 * - la clé Interfast est chiffrée (AES-256-GCM) et ne repart JAMAIS au navigateur.
 */
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { streamSSE } from 'hono/streaming';
import type { BetaMessageParam } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { Config } from './config';
import type { Db } from './db';
import { decrypt, encrypt, hint } from './crypto';
import { codeMail, passwordChangedMail } from './emails';
import type { Mailer } from './mail';
import { isWriteTool, McpError, type McpClient, type McpTool } from './mcp';
import { DUMMY_HASH, PASSWORD_MIN, deviceLabel, hashPassword, isEmail, isUuid, newOtp, newToken, normalizeEmail, sha256, verifyPassword } from './security';
import { runTurn, type ActionState, type Answer, type Llm, type Pending } from './agent';
import { SYSTEM_PROMPT, sessionContext, type ArtisanSettings, type PastSession, type RexItem } from './prompt';
import { toView } from './view';
import { collectOverview, OVERVIEW_TTL_MS, type Overview, type RecipeCall } from './overview';

export interface Deps {
  cfg: Config;
  db: Db;
  mailer: Mailer;
  llm: Llm | null;
  mcpFactory: (url: string, apiKey: string | null) => McpClient;
  now?: () => Date;
}

export interface User {
  id: string;
  email: string;
  name: string;
}

type Env = { Variables: { user: User | null } };

const SESSION_COOKIE = 'envo_session';
const SESSION_DAYS = 30;
const CODE_MINUTES = 15;
const CODE_ATTEMPTS = 5;
const CODE_RESEND_S = 60;
const CODE_SENDS_PER_HOUR = 5;
const PASSWORD_MAX = 256;
const TOOLS_TTL_MS = 10 * 60_000;
const REX_IN_CONTEXT = 40;
export const REX_KINDS = ['decision', 'preference', 'tarif', 'client', 'methode', 'avis'] as const;

/**
 * URL du serveur MCP saisie par l'artisan, et que le SERVEUR va appeler : https
 * seulement, jamais une adresse locale ou privée (sinon un compte pourrait faire
 * sonder le réseau interne du VPS).
 */
export function validMcpUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.username || u.password) return null;
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || !h.includes('.') && !h.includes(':')) return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const [a, b] = h.split('.').map(Number) as [number, number];
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) return null;
  }
  if (h.includes(':') && (h === '::1' || /^(fc|fd|fe80)/.test(h) || h.startsWith('::ffff:'))) return null;
  return u.toString();
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) && n >= 0 && n < 1e7 ? n : null;
};
const str = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
const toNum = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export function createApp(deps: Deps) {
  const { cfg, db, mailer, llm } = deps;
  const now = deps.now ?? (() => new Date());
  const origin = new URL(cfg.publicUrl).origin;
  const secure = cfg.publicUrl.startsWith('https://');
  const app = new Hono<Env>();
  const busy = new Set<string>();
  const toolsCache = new Map<string, { at: number; tools: McpTool[] }>();
  /** Tableau de bord Interfast : EN MÉMOIRE seulement (les données métier ne vont pas en base), par compte. */
  const overviews = new Map<string, { at: number; key: string; data: Overview }>();
  const collecting = new Set<string>();

  /* ---------- Rythme : échecs par clé, débit par IP ---------- */
  const fails = new Map<string, { n: number; until: number }>();
  const sweep = (m: Map<string, { until: number }>, t: number) => {
    if (m.size <= 10_000) return;
    for (const [k, v] of m) if (v.until <= t) m.delete(k);
    for (const k of m.keys()) {
      if (m.size <= 9_000) break;
      m.delete(k);
    }
  };
  const tooMany = (key: string) => {
    const a = fails.get(key);
    return !!a && a.until > now().getTime() && a.n >= 10;
  };
  const failed = (key: string) => {
    const t = now().getTime();
    const a = fails.get(key);
    if (!a || a.until <= t) fails.set(key, { n: 1, until: t + 15 * 60_000 });
    else a.n += 1;
    sweep(fails, t);
  };
  const hits = new Map<string, { n: number; until: number }>();
  const overRate = (key: string, max: number, windowMs: number) => {
    const t = now().getTime();
    const h = hits.get(key);
    if (!h || h.until <= t) hits.set(key, { n: 1, until: t + windowMs });
    else h.n += 1;
    sweep(hits, t);
    return (hits.get(key)?.n ?? 0) > max;
  };
  const clientIp = (c: Context) => c.req.header('x-real-ip') ?? 'local';

  /* ---------- Sessions ---------- */
  async function openSession(c: Context<Env>, userId: string) {
    const token = newToken();
    const t = now();
    const expires = new Date(t.getTime() + SESSION_DAYS * 86_400_000);
    await db.query('INSERT INTO sessions (token_hash, user_id, expires_at, device, last_seen_at) VALUES ($1, $2, $3, $4, $5)', [sha256(token), userId, expires, deviceLabel(c.req.header('user-agent')), t]);
    setCookie(c, SESSION_COOKIE, token, { httpOnly: true, secure, sameSite: 'Lax', path: '/', expires });
  }

  app.use('*', async (c, next) => {
    c.set('user', null);
    const token = getCookie(c, SESSION_COOKIE);
    if (token) {
      const rows = await db.query<User & { last_seen_at: Date | null }>(
        `SELECT u.id, u.email, u.name, s.last_seen_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > $2`,
        [sha256(token), now()],
      );
      const r = rows[0];
      if (r) {
        c.set('user', { id: r.id, email: r.email, name: r.name });
        if (!r.last_seen_at || now().getTime() - new Date(r.last_seen_at).getTime() > 15 * 60_000)
          await db.query('UPDATE sessions SET last_seen_at = $2 WHERE token_hash = $1', [sha256(token), now()]);
      }
    }
    await next();
  });

  app.use('/api/*', async (c, next) => {
    if (Number(c.req.header('content-length') ?? 0) > 1024 * 1024) return c.json({ error: 'requête trop volumineuse' }, 413);
    await next();
    if (!c.res.headers.has('Cache-Control')) c.res.headers.set('Cache-Control', 'no-store');
  });
  app.use('/api/*', async (c, next) => {
    if (c.req.method === 'GET' || c.req.method === 'HEAD') return next();
    return bodyLimit({ maxSize: 1024 * 1024, onError: (cc) => cc.json({ error: 'requête trop volumineuse' }, 413) })(c, next);
  });

  /* ---------- Anti-CSRF : une écriture vient de notre propre origine ---------- */
  app.use('/api/*', async (c, next) => {
    const m = c.req.method;
    if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return next();
    const o = c.req.header('origin');
    const site = c.req.header('sec-fetch-site');
    if (o ? o !== origin : site !== 'same-origin') return c.json({ error: 'origine refusée' }, 403);
    return next();
  });

  const readJson = async <T>(c: Context): Promise<Partial<T>> => {
    try {
      const v = await c.req.json();
      return v && typeof v === 'object' ? (v as Partial<T>) : {};
    } catch {
      return {};
    }
  };
  const unauthorized = (c: Context) => c.json({ error: 'connexion requise' }, 401);

  /**
   * Réponse en flux (SSE) qui traverse nginx : `X-Accel-Buffering: no` (pas de
   * mise en tampon, quelle que soit la configuration du vhost) et un signal de
   * vie toutes les 15 s — nginx coupe une réponse muette au bout de 60 s, et un
   * appel à Claude ou à Interfast peut durer plus.
   */
  const sse = (c: Context, fn: (stream: Parameters<Parameters<typeof streamSSE>[1]>[0]) => Promise<void>) => {
    c.header('X-Accel-Buffering', 'no');
    return streamSSE(c, async (stream) => {
      const ping = setInterval(() => void stream.write(': ping\n\n').catch(() => {}), 15_000);
      try {
        await fn(stream);
      } finally {
        clearInterval(ping);
      }
    });
  };

  /* ---------- Santé (lue par le déploiement : chaîne exacte) ---------- */
  app.get('/api/health', async (c) => {
    let ok = true;
    try {
      await db.query('SELECT 1');
    } catch {
      ok = false;
    }
    return c.json({ db: ok, commit: cfg.commit }, ok ? 200 : 503);
  });

  /* ---------- Codes à 6 chiffres ---------- */
  const codeHash = (scope: string, code: string) => sha256(`${scope}:${code}`);
  const sendCode = async (email: string, code: string, purpose: 'inscription' | 'connexion' | 'reinitialisation') => {
    if (!mailer.enabled) {
      // Sans Mailjet, le code est dans le journal du serveur : seul qui le lit peut entrer.
      console.warn(`[${purpose}] e-mail non configuré — code pour ${email} : ${code}`);
      return;
    }
    await mailer.send({ to: email, ...codeMail({ code, minutes: CODE_MINUTES, purpose }) });
  };

  /* ---------- Comptes ---------- */
  app.get('/api/auth/me', (c) => c.json({ user: c.get('user'), mail: mailer.enabled, assistant: llm !== null }));

  app.post('/api/auth/register', async (c) => {
    const body = await readJson<{ email: string; password: string; name: string }>(c);
    const email = normalizeEmail(String(body.email ?? ''));
    const password = String(body.password ?? '');
    const name = str(body.name, 80);
    if (!isEmail(email)) return c.json({ error: 'adresse e-mail invalide' }, 400);
    if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) return c.json({ error: `mot de passe de ${PASSWORD_MIN} caractères au moins` }, 400);
    if (overRate(`register:${clientIp(c)}`, 10, 3600_000)) return c.json({ error: 'trop de demandes, réessayez plus tard' }, 429);
    const exists = await db.query('SELECT 1 FROM users WHERE email = $1', [email]);
    // Même réponse qu'une adresse soit connue ou non : l'inscription ne sert pas d'annuaire.
    if (exists.length) return c.json({ ok: true });
    const t = now();
    const prev = (await db.query<{ sends: number; window_start: Date; sent_at: Date }>('SELECT sends, window_start, sent_at FROM pending_signups WHERE email = $1', [email]))[0];
    let sends = 1;
    let windowStart = t;
    if (prev) {
      if (t.getTime() - new Date(prev.sent_at).getTime() < CODE_RESEND_S * 1000) return c.json({ ok: true });
      const inWindow = t.getTime() - new Date(prev.window_start).getTime() < 3600_000;
      sends = inWindow ? prev.sends + 1 : 1;
      windowStart = inWindow ? new Date(prev.window_start) : t;
      if (sends > CODE_SENDS_PER_HOUR) return c.json({ error: 'trop de codes envoyés, réessayez dans une heure' }, 429);
    }
    const code = newOtp();
    await db.query(
      `INSERT INTO pending_signups (email, password_hash, name, code_hash, attempts, sends, window_start, sent_at, expires_at)
       VALUES ($1, $2, $3, $4, 0, $5, $6, $7, $8)
       ON CONFLICT (email) DO UPDATE SET password_hash = $2, name = $3, code_hash = $4, attempts = 0, sends = $5, window_start = $6, sent_at = $7, expires_at = $8`,
      [email, await hashPassword(password), name, codeHash(email, code), sends, windowStart, t, new Date(t.getTime() + CODE_MINUTES * 60_000)],
    );
    await sendCode(email, code, 'inscription');
    return c.json({ ok: true });
  });

  app.post('/api/auth/verify', async (c) => {
    const body = await readJson<{ email: string; code: string }>(c);
    const email = normalizeEmail(String(body.email ?? ''));
    const code = String(body.code ?? '').replace(/\s/g, '');
    const p = (await db.query<{ password_hash: string; name: string; code_hash: string; attempts: number; expires_at: Date }>('SELECT * FROM pending_signups WHERE email = $1', [email]))[0];
    if (!p || new Date(p.expires_at) < now() || p.attempts >= CODE_ATTEMPTS) return c.json({ error: 'code expiré : demandez-en un nouveau' }, 400);
    if (codeHash(email, code) !== p.code_hash) {
      await db.query('UPDATE pending_signups SET attempts = attempts + 1 WHERE email = $1', [email]);
      return c.json({ error: 'code incorrect' }, 400);
    }
    const u = (await db.query<{ id: string }>('INSERT INTO users (email, password_hash, name, password_changed_at) VALUES ($1, $2, $3, $4) ON CONFLICT (email) DO NOTHING RETURNING id', [email, p.password_hash, p.name, now()]))[0];
    await db.query('DELETE FROM pending_signups WHERE email = $1', [email]);
    if (!u) return c.json({ error: 'compte déjà créé : connectez-vous' }, 409);
    await db.query('INSERT INTO settings (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [u.id]);
    await openSession(c, u.id);
    return c.json({ user: { id: u.id, email, name: p.name } });
  });

  /** Étape intermédiaire (connexion ou réinitialisation) : un jeton d'étape + un code envoyé. */
  async function challenge(userId: string | null, email: string, purpose: 'connexion' | 'reinitialisation'): Promise<string> {
    const token = newToken();
    if (userId) {
      const code = newOtp();
      const t = now();
      await db.query('DELETE FROM login_challenges WHERE user_id = $1 AND purpose = $2', [userId, purpose]);
      await db.query('INSERT INTO login_challenges (token_hash, user_id, purpose, code_hash, sent_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6)', [
        sha256(token),
        userId,
        purpose,
        codeHash(token, code),
        t,
        new Date(t.getTime() + CODE_MINUTES * 60_000),
      ]);
      await sendCode(email, code, purpose);
    }
    return token;
  }

  async function checkChallenge(token: string, code: string, purpose: string): Promise<{ userId: string } | { error: string }> {
    const ch = (await db.query<{ user_id: string; code_hash: string; attempts: number; expires_at: Date }>('SELECT * FROM login_challenges WHERE token_hash = $1 AND purpose = $2', [sha256(token), purpose]))[0];
    if (!ch || new Date(ch.expires_at) < now() || ch.attempts >= CODE_ATTEMPTS) return { error: 'code expiré : recommencez' };
    if (codeHash(token, code.replace(/\s/g, '')) !== ch.code_hash) {
      await db.query('UPDATE login_challenges SET attempts = attempts + 1 WHERE token_hash = $1', [sha256(token)]);
      return { error: 'code incorrect' };
    }
    await db.query('DELETE FROM login_challenges WHERE token_hash = $1', [sha256(token)]);
    return { userId: ch.user_id };
  }

  app.post('/api/auth/login', async (c) => {
    const body = await readJson<{ email: string; password: string }>(c);
    const email = normalizeEmail(String(body.email ?? ''));
    const password = String(body.password ?? '').slice(0, PASSWORD_MAX);
    const key = `login:${clientIp(c)}:${email}`;
    if (tooMany(key)) return c.json({ error: 'trop d’essais : réessayez dans 15 minutes' }, 429);
    const u = (await db.query<{ id: string; password_hash: string }>('SELECT id, password_hash FROM users WHERE email = $1', [email]))[0];
    const ok = await verifyPassword(password, u?.password_hash ?? DUMMY_HASH);
    if (!u || !ok) {
      failed(key);
      return c.json({ error: 'adresse ou mot de passe incorrect' }, 401);
    }
    // Double authentification : le mot de passe seul n'ouvre rien, un code part par e-mail.
    return c.json({ second: await challenge(u.id, email, 'connexion') });
  });

  app.post('/api/auth/second/verify', async (c) => {
    const body = await readJson<{ second: string; code: string }>(c);
    const r = await checkChallenge(String(body.second ?? ''), String(body.code ?? ''), 'connexion');
    if ('error' in r) return c.json({ error: r.error }, 400);
    await openSession(c, r.userId);
    const u = (await db.query<User>('SELECT id, email, name FROM users WHERE id = $1', [r.userId]))[0];
    return c.json({ user: u });
  });

  app.post('/api/auth/second/resend', async (c) => {
    const body = await readJson<{ second: string }>(c);
    const token = String(body.second ?? '');
    const ch = (await db.query<{ user_id: string; sends: number; sent_at: Date; expires_at: Date; purpose: string }>('SELECT * FROM login_challenges WHERE token_hash = $1', [sha256(token)]))[0];
    if (!ch || new Date(ch.expires_at) < now()) return c.json({ error: 'recommencez la connexion' }, 400);
    if (now().getTime() - new Date(ch.sent_at).getTime() < CODE_RESEND_S * 1000) return c.json({ error: 'patientez une minute avant un nouvel envoi' }, 429);
    if (ch.sends >= CODE_SENDS_PER_HOUR) return c.json({ error: 'trop de codes envoyés' }, 429);
    const code = newOtp();
    await db.query('UPDATE login_challenges SET code_hash = $2, sends = sends + 1, sent_at = $3, attempts = 0 WHERE token_hash = $1', [sha256(token), codeHash(token, code), now()]);
    const u = (await db.query<{ email: string }>('SELECT email FROM users WHERE id = $1', [ch.user_id]))[0];
    if (u) await sendCode(u.email, code, ch.purpose === 'reinitialisation' ? 'reinitialisation' : 'connexion');
    return c.json({ ok: true });
  });

  app.post('/api/auth/forgot', async (c) => {
    const body = await readJson<{ email: string }>(c);
    const email = normalizeEmail(String(body.email ?? ''));
    if (overRate(`forgot:${clientIp(c)}`, 5, 3600_000)) return c.json({ error: 'trop de demandes, réessayez plus tard' }, 429);
    const u = isEmail(email) ? (await db.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [email]))[0] : undefined;
    // Un jeton est rendu dans tous les cas : la réponse ne dit pas si l'adresse existe.
    return c.json({ reset: await challenge(u?.id ?? null, email, 'reinitialisation') });
  });

  app.post('/api/auth/reset', async (c) => {
    const body = await readJson<{ reset: string; code: string; password: string }>(c);
    const password = String(body.password ?? '');
    if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) return c.json({ error: `mot de passe de ${PASSWORD_MIN} caractères au moins` }, 400);
    const r = await checkChallenge(String(body.reset ?? ''), String(body.code ?? ''), 'reinitialisation');
    if ('error' in r) return c.json({ error: r.error }, 400);
    await db.query('UPDATE users SET password_hash = $2, password_changed_at = $3 WHERE id = $1', [r.userId, await hashPassword(password), now()]);
    await db.query('DELETE FROM sessions WHERE user_id = $1', [r.userId]);
    await openSession(c, r.userId);
    const u = (await db.query<User>('SELECT id, email, name FROM users WHERE id = $1', [r.userId]))[0];
    return c.json({ user: u });
  });

  app.post('/api/auth/logout', async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) await db.query('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]);
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  app.post('/api/account/password', async (c) => {
    const u = c.get('user');
    if (!u) return unauthorized(c);
    const body = await readJson<{ current: string; password: string }>(c);
    const key = `pw:${u.id}`;
    if (tooMany(key)) return c.json({ error: 'trop d’essais : réessayez dans 15 minutes' }, 429);
    const row = (await db.query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [u.id]))[0];
    if (!(await verifyPassword(String(body.current ?? '').slice(0, PASSWORD_MAX), row?.password_hash ?? DUMMY_HASH))) {
      failed(key);
      return c.json({ error: 'mot de passe actuel incorrect' }, 400);
    }
    const password = String(body.password ?? '');
    if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) return c.json({ error: `mot de passe de ${PASSWORD_MIN} caractères au moins` }, 400);
    await db.query('UPDATE users SET password_hash = $2, password_changed_at = $3 WHERE id = $1', [u.id, await hashPassword(password), now()]);
    // Les autres appareils sont déconnectés ; celui-ci garde sa session.
    await db.query('DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2', [u.id, sha256(getCookie(c, SESSION_COOKIE) ?? '')]);
    if (mailer.enabled) await mailer.send({ to: u.email, ...passwordChangedMail({ at: now() }) }).catch((e) => console.error('alerte non envoyée :', (e as Error).message));
    return c.json({ ok: true });
  });

  /* ---------- Réglages et connexion Interfast ---------- */
  type SettingsRow = ArtisanSettings & { mcp_url: string; mcp_key_enc: string | null; mcp_key_hint: string; voice_reply: boolean };

  async function loadSettings(userId: string): Promise<SettingsRow> {
    await db.query('INSERT INTO settings (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [userId]);
    const r = (await db.query<SettingsRow>('SELECT * FROM settings WHERE user_id = $1', [userId]))[0]!;
    return { ...r, hourly_rate: toNum(r.hourly_rate), vat_rate: toNum(r.vat_rate), margin_pct: toNum(r.margin_pct), travel_fee: toNum(r.travel_fee), validity_days: toNum(r.validity_days) };
  }

  const publicSettings = (s: SettingsRow) => ({
    company: s.company,
    trade: s.trade,
    hourly_rate: s.hourly_rate,
    vat_rate: s.vat_rate,
    margin_pct: s.margin_pct,
    travel_fee: s.travel_fee,
    validity_days: s.validity_days,
    notes: s.notes,
    voice_reply: s.voice_reply,
    mcp: { url: s.mcp_url, keyHint: s.mcp_key_hint, configured: !!s.mcp_url },
  });

  function mcpFor(s: SettingsRow): McpClient | null {
    if (!s.mcp_url) return null;
    const key = s.mcp_key_enc ? decrypt(cfg.secretKey, s.mcp_key_enc) : null;
    return deps.mcpFactory(s.mcp_url, key);
  }

  async function toolsFor(userId: string, s: SettingsRow, mcp: McpClient | null, fresh = false): Promise<McpTool[]> {
    if (!mcp) return [];
    const k = `${userId}|${s.mcp_url}|${s.mcp_key_hint}`;
    const hit = toolsCache.get(k);
    if (!fresh && hit && now().getTime() - hit.at < TOOLS_TTL_MS) return hit.tools;
    const tools = await mcp.listTools();
    toolsCache.set(k, { at: now().getTime(), tools });
    return tools;
  }

  app.get('/api/settings', async (c) => {
    const u = c.get('user');
    if (!u) return unauthorized(c);
    return c.json({ settings: publicSettings(await loadSettings(u.id)), name: u.name });
  });

  app.put('/api/settings', async (c) => {
    const u = c.get('user');
    if (!u) return unauthorized(c);
    const b = await readJson<Record<string, unknown>>(c);
    const cur = await loadSettings(u.id);
    let mcpUrl = cur.mcp_url;
    if (typeof b.mcp_url === 'string') {
      if (!b.mcp_url.trim()) mcpUrl = '';
      else {
        const v = validMcpUrl(b.mcp_url);
        if (!v) return c.json({ error: 'URL du serveur MCP invalide : une adresse https publique est attendue' }, 400);
        mcpUrl = v;
      }
    }
    let keyEnc = cur.mcp_key_enc;
    let keyHint = cur.mcp_key_hint;
    if (b.mcp_key_clear === true) {
      keyEnc = null;
      keyHint = '';
    } else if (typeof b.mcp_key === 'string' && b.mcp_key.trim()) {
      const k = b.mcp_key.trim().slice(0, 500);
      keyEnc = encrypt(cfg.secretKey, k);
      keyHint = hint(k);
    }
    // Autre serveur Interfast : les appels mémorisés pour le tableau de bord ne valent plus.
    if (mcpUrl !== cur.mcp_url) await db.query('UPDATE settings SET overview_recipe = NULL WHERE user_id = $1', [u.id]);
    const name = typeof b.name === 'string' ? str(b.name, 80) : u.name;
    await db.query('UPDATE users SET name = $2 WHERE id = $1', [u.id, name]);
    const pick = (k: string, cur: number | null) => (k in b ? num(b[k]) : cur);
    await db.query(
      `UPDATE settings SET company = $2, trade = $3, hourly_rate = $4, vat_rate = $5, margin_pct = $6, travel_fee = $7, validity_days = $8, notes = $9,
         mcp_url = $10, mcp_key_enc = $11, mcp_key_hint = $12, voice_reply = $13, updated_at = $14 WHERE user_id = $1`,
      [
        u.id,
        typeof b.company === 'string' ? str(b.company, 120) : cur.company,
        typeof b.trade === 'string' ? str(b.trade, 80) : cur.trade,
        pick('hourly_rate', cur.hourly_rate),
        pick('vat_rate', cur.vat_rate),
        pick('margin_pct', cur.margin_pct),
        pick('travel_fee', cur.travel_fee),
        'validity_days' in b ? (num(b.validity_days) === null ? null : Math.round(num(b.validity_days)!)) : cur.validity_days,
        typeof b.notes === 'string' ? str(b.notes, 2000) : cur.notes,
        mcpUrl,
        keyEnc,
        keyHint,
        typeof b.voice_reply === 'boolean' ? b.voice_reply : cur.voice_reply,
        now(),
      ],
    );
    return c.json({ settings: publicSettings(await loadSettings(u.id)), name });
  });

  app.post('/api/settings/test', async (c) => {
    const u = c.get('user');
    if (!u) return unauthorized(c);
    if (overRate(`mcptest:${u.id}`, 20, 3600_000)) return c.json({ error: 'trop d’essais, patientez' }, 429);
    const s = await loadSettings(u.id);
    const mcp = mcpFor(s);
    if (!mcp) return c.json({ ok: false, error: 'renseignez d’abord l’URL du serveur MCP' });
    if (s.mcp_key_enc && decrypt(cfg.secretKey, s.mcp_key_enc) === null) return c.json({ ok: false, error: 'clé illisible (clé de chiffrement du serveur changée) : ressaisissez-la' });
    try {
      const tools = await toolsFor(u.id, s, mcp, true);
      return c.json({ ok: true, tools: tools.map((t) => ({ name: t.name, description: (t.description ?? '').slice(0, 240), write: isWriteTool(t) })) });
    } catch (e) {
      return c.json({ ok: false, error: e instanceof McpError ? e.message : 'connexion impossible' });
    }
  });

  /* ---------- REX ---------- */
  app.get('/api/rex', async (c) => {
    const u = c.get('user');
    if (!u) return unauthorized(c);
    const rows = await db.query('SELECT id, kind, content, tags, uses, created_at FROM rex WHERE user_id = $1 ORDER BY created_at DESC LIMIT 500', [u.id]);
    return c.json({ rex: rows });
  });

  app.post('/api/rex', async (c) => {
    const u = c.get('user');
    if (!u) return unauthorized(c);
    const b = await readJson<{ kind: string; content: string }>(c);
    const kind = REX_KINDS.includes(b.kind as (typeof REX_KINDS)[number]) ? b.kind! : 'preference';
    const content = str(b.content, 600);
    if (!content) return c.json({ error: 'contenu vide' }, 400);
    const r = (await db.query('INSERT INTO rex (user_id, kind, content) VALUES ($1, $2, $3) RETURNING id, kind, content, tags, uses, created_at', [u.id, kind, content]))[0];
    return c.json({ rex: r });
  });

  app.patch('/api/rex/:id', async (c) => {
    const u = c.get('user');
    if (!u) return unauthorized(c);
    const id = c.req.param('id');
    if (!isUuid(id)) return c.json({ error: 'introuvable' }, 404);
    const content = str((await readJson<{ content: string }>(c)).content, 600);
    if (!content) return c.json({ error: 'contenu vide' }, 400);
    const r = await db.query('UPDATE rex SET content = $3 WHERE id = $1 AND user_id = $2 RETURNING id', [id, u.id, content]);
    return r.length ? c.json({ ok: true }) : c.json({ error: 'introuvable' }, 404);
  });

  app.delete('/api/rex/:id', async (c) => {
    const u = c.get('user');
    if (!u) return unauthorized(c);
    const id = c.req.param('id');
    if (!isUuid(id)) return c.json({ error: 'introuvable' }, 404);
    await db.query('DELETE FROM rex WHERE id = $1 AND user_id = $2', [id, u.id]);
    return c.json({ ok: true });
  });

  /* ---------- Conversations ---------- */
  type ConvRow = { id: string; title: string; status: string; kind: string; context: string; pending: Pending | null; outcome: string; rating: number | null; created_at: Date; updated_at: Date };

  async function ownConv(userId: string, id: string): Promise<ConvRow | null> {
    if (!isUuid(id)) return null;
    return (await db.query<ConvRow>('SELECT * FROM conversations WHERE id = $1 AND user_id = $2', [id, userId]))[0] ?? null;
  }

  async function history(convId: string): Promise<BetaMessageParam[]> {
    const rows = await db.query<{ role: 'user' | 'assistant'; content: unknown }>('SELECT role, content FROM messages WHERE conversation_id = $1 ORDER BY id', [convId]);
    return rows.map((r) => ({ role: r.role, content: r.content }) as BetaMessageParam);
  }

  async function actionStates(convId: string): Promise<Map<string, ActionState>> {
    const rows = await db.query<{ tool_use_id: string; state: ActionState }>('SELECT tool_use_id, state FROM actions WHERE conversation_id = $1', [convId]);
    return new Map(rows.map((r) => [r.tool_use_id, r.state]));
  }

  async function convView(conv: ConvRow) {
    return {
      conversation: { id: conv.id, title: conv.title, status: conv.status, kind: conv.kind, rating: conv.rating, outcome: conv.outcome, updated_at: conv.updated_at },
      items: toView(await history(conv.id), conv.pending, await actionStates(conv.id)),
      waiting: conv.pending?.waiting.map((w) => ({ id: w.toolUseId, kind: w.kind })) ?? [],
    };
  }

  app.get('/api/conversations', async (c) => {
    const u = c.get('user');
    if (!u) return unauthorized(c);
    const rows = await db.query(
      `SELECT id, title, status, kind, outcome, rating, (pending IS NOT NULL) AS waiting, created_at, updated_at FROM conversations WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 100`,
      [u.id],
    );
    return c.json({ conversations: rows });
  });

  app.post('/api/conversations', async (c) => {
    const u = c.get('user');
    if (!u) return unauthorized(c);
    if (overRate(`conv:${u.id}`, 60, 3600_000)) return c.json({ error: 'trop de séances ouvertes, patientez' }, 429);
    const s = await loadSettings(u.id);
    const rex = await db.query<RexItem>(
      `(SELECT kind, content, created_at FROM rex WHERE user_id = $1 AND kind <> 'avis' ORDER BY uses DESC, created_at DESC LIMIT ${REX_IN_CONTEXT})
       UNION ALL (SELECT kind, content, created_at FROM rex WHERE user_id = $1 AND kind = 'avis' ORDER BY created_at DESC LIMIT 8)`,
      [u.id],
    );
    const past = await db.query<PastSession>(`SELECT title, status, outcome, feedback, rating FROM conversations WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 10`, [u.id]);
    const context = sessionContext({ name: u.name, now: now(), settings: s, rex, past });
    const r = (await db.query<{ id: string }>('INSERT INTO conversations (user_id, kind, context) VALUES ($1, $2, $3) RETURNING id', [u.id, 'devis', context]))[0]!;
    return c.json({ id: r.id });
  });

  app.get('/api/conversations/:id', async (c) => {
    const u = c.get('user');
    if (!u) return unauthorized(c);
    const conv = await ownConv(u.id, c.req.param('id'));
    if (!conv) return c.json({ error: 'introuvable' }, 404);
    return c.json(await convView(conv));
  });

  app.delete('/api/conversations/:id', async (c) => {
    const u = c.get('user');
    if (!u) return unauthorized(c);
    const conv = await ownConv(u.id, c.req.param('id'));
    if (!conv) return c.json({ error: 'introuvable' }, 404);
    await db.query('DELETE FROM conversations WHERE id = $1 AND user_id = $2', [conv.id, u.id]);
    return c.json({ ok: true });
  });

  /** Fin de séance : note et avis, qui deviennent du REX quand ils disent quelque chose. */
  app.post('/api/conversations/:id/close', async (c) => {
    const u = c.get('user');
    if (!u) return unauthorized(c);
    const conv = await ownConv(u.id, c.req.param('id'));
    if (!conv) return c.json({ error: 'introuvable' }, 404);
    const b = await readJson<{ rating: number; feedback: string }>(c);
    const rating = Number.isInteger(b.rating) && b.rating! >= 1 && b.rating! <= 5 ? b.rating! : null;
    const feedback = str(b.feedback, 1000);
    await db.query(`UPDATE conversations SET status = CASE WHEN status = 'devis_cree' THEN status ELSE 'termine' END, rating = $3, feedback = $4, updated_at = $5 WHERE id = $1 AND user_id = $2`, [
      conv.id,
      u.id,
      rating,
      feedback,
      now(),
    ]);
    if (feedback) await db.query('INSERT INTO rex (user_id, kind, content, source_conversation) VALUES ($1, $2, $3, $4)', [u.id, 'avis', feedback, conv.id]);
    return c.json({ ok: true });
  });

  app.post('/api/conversations/:id/turn', async (c) => {
    const u = c.get('user');
    if (!u) return unauthorized(c);
    const conv = await ownConv(u.id, c.req.param('id'));
    if (!conv) return c.json({ error: 'introuvable' }, 404);
    if (!llm || !cfg.anthropic) return c.json({ error: 'assistante non configurée sur le serveur (clé Anthropic absente)' }, 503);
    const b = await readJson<{ text: string; answers: Answer[] }>(c);
    const text = str(b.text, 8000);
    const answers = Array.isArray(b.answers)
      ? b.answers
          .filter((a) => a && typeof a.toolUseId === 'string')
          .map((a) => ({ toolUseId: a.toolUseId, choice: typeof a.choice === 'string' ? a.choice.slice(0, 1000) : undefined, approved: typeof a.approved === 'boolean' ? a.approved : undefined }))
      : [];
    if (!text && !answers.length) return c.json({ error: 'message vide' }, 400);
    if (!conv.pending && !text) return c.json({ error: 'message vide' }, 400);
    if (overRate(`turn:${u.id}`, 120, 3600_000)) return c.json({ error: 'trop de messages en une heure, patientez' }, 429);
    if (busy.has(conv.id)) return c.json({ error: 'l’assistante répond déjà dans cette séance' }, 409);
    busy.add(conv.id);

    const anthropic = cfg.anthropic;
    const work = async (onStatus: (t: string) => void) => {
      const s = await loadSettings(u.id);
      const mcp = mcpFor(s);
      let mcpTools: McpTool[] = [];
      let mcpNote = '';
      try {
        mcpTools = await toolsFor(u.id, s, mcp);
      } catch (e) {
        mcpNote = e instanceof McpError ? e.message : 'Interfast injoignable';
      }
      const hist = await history(conv.id);
      const res = await runTurn(
        {
          llm,
          model: anthropic.model,
          effort: anthropic.effort,
          mcp,
          mcpTools,
          systemPrompt: SYSTEM_PROMPT,
          context: conv.context + (mcp ? '' : '\n\n# Interfast\nNON CONNECTÉ : l’artisan doit renseigner l’URL du serveur MCP dans Paramètres. Tu peux préparer un brouillon, pas le créer.'),
          history: hist,
          pending: conv.pending,
          onStatus,
          remember: async (kind, content, tags) => {
            await db.query('INSERT INTO rex (user_id, kind, content, tags, source_conversation) VALUES ($1, $2, $3, $4, $5)', [u.id, REX_KINDS.includes(kind as never) ? kind : 'decision', content, tags, conv.id]);
          },
          searchRex: async (q) => {
            const words = q.toLowerCase().split(/[^a-z0-9à-ÿ]+/i).filter((w) => w.length >= 3).slice(0, 6);
            if (!words.length) return [];
            const like = words.map((_, i) => `(lower(content) LIKE $${i + 2} OR lower(tags) LIKE $${i + 2})`).join(' OR ');
            const rows = await db.query<{ id: string; kind: string; content: string; created_at: Date }>(`SELECT id, kind, content, created_at FROM rex WHERE user_id = $1 AND (${like}) ORDER BY created_at DESC LIMIT 15`, [
              u.id,
              ...words.map((w) => `%${w.replace(/[%_\\]/g, '')}%`),
            ]);
            if (rows.length) await db.query('UPDATE rex SET uses = uses + 1, last_used_at = $2 WHERE id = ANY($1::uuid[])', [rows.map((r) => r.id), now()]);
            return rows;
          },
          logTool: async (tool, ok, ms) => {
            await db.query('INSERT INTO tool_log (user_id, conversation_id, tool, ok, ms) VALUES ($1, $2, $3, $4, $5)', [u.id, conv.id, tool, ok, ms]);
          },
          recordAction: async (a) => {
            await db.query(
              `INSERT INTO actions (tool_use_id, conversation_id, user_id, tool, input, state, result) VALUES ($1, $2, $3, $4, $5::text::jsonb, $6, $7)
               ON CONFLICT (tool_use_id) DO UPDATE SET state = $6, result = $7, decided_at = $8 WHERE actions.user_id = $3`,
              [a.toolUseId, conv.id, u.id, a.tool, JSON.stringify(a.input), a.state, a.result ?? '', now()],
            );
          },
        },
        { text, answers },
      );
      for (const m of res.appended) await db.query('INSERT INTO messages (conversation_id, role, content) VALUES ($1, $2, $3::text::jsonb)', [conv.id, m.role, JSON.stringify(m.content)]);
      const title = conv.title || text.slice(0, 70);
      await db.query(
        `UPDATE conversations SET pending = $3::text::jsonb, title = $4, updated_at = $5,
           status = CASE WHEN $6::text <> '' THEN 'devis_cree' WHEN status = 'termine' THEN 'en_cours' ELSE status END,
           outcome = CASE WHEN $6::text <> '' THEN $6::text ELSE outcome END
         WHERE id = $1 AND user_id = $2`,
        [conv.id, u.id, res.pending ? JSON.stringify(res.pending) : null, title, now(), res.created ?? ''],
      );
      const fresh = (await ownConv(u.id, conv.id))!;
      return { ...(await convView(fresh)), stop: res.stop, mcpNote };
    };

    // Réponse en flux (SSE) : l'écran voit ce que fait l'assistante pendant qu'elle travaille,
    // et une connexion qui tombe n'interrompt pas le tour — il est enregistré quand même.
    return sse(c, async (stream) => {
      try {
        const out = await work((t) => void stream.writeSSE({ event: 'status', data: t }).catch(() => {}));
        await stream.writeSSE({ event: 'done', data: JSON.stringify(out) }).catch(() => {});
      } catch (e) {
        console.error('tour de l’assistante :', e);
        await stream.writeSSE({ event: 'error', data: JSON.stringify({ error: 'L’assistante n’a pas pu répondre. Réessayez dans un instant.' }) }).catch(() => {});
      } finally {
        busy.delete(conv.id);
      }
    });
  });

  /* ---------- Interfast : état de la connexion et tableau de bord ---------- */
  const host = (url: string) => {
    try {
      return new URL(url).host;
    } catch {
      return '';
    }
  };

  /** État de la connexion : joignable ? combien d'outils ? quel délai ? quelle activité cette semaine ? */
  app.get('/api/interfast/status', async (c) => {
    const u = c.get('user');
    if (!u) return unauthorized(c);
    const s = await loadSettings(u.id);
    const week = new Date(now().getTime() - 7 * 86_400_000);
    const stats = (
      await db.query<{ calls: number; errors: number; avg_ms: number | null; last_ok: Date | null; last_error: Date | null }>(
        `SELECT count(*)::int AS calls, count(*) FILTER (WHERE NOT ok)::int AS errors, round(avg(ms))::int AS avg_ms,
                max(created_at) FILTER (WHERE ok) AS last_ok, max(created_at) FILTER (WHERE NOT ok) AS last_error
           FROM tool_log WHERE user_id = $1 AND created_at >= $2`,
        [u.id, week],
      )
    )[0]!;
    const top = await db.query<{ tool: string; n: number }>(`SELECT tool, count(*)::int AS n FROM tool_log WHERE user_id = $1 AND created_at >= $2 GROUP BY tool ORDER BY n DESC LIMIT 5`, [u.id, week]);
    const last = (await db.query<{ overview_stats: unknown }>('SELECT overview_stats FROM settings WHERE user_id = $1', [u.id]))[0]?.overview_stats ?? null;
    const base = { configured: !!s.mcp_url, host: host(s.mcp_url), keyHint: s.mcp_key_hint, week: { ...stats, top }, lastRead: last };
    const mcp = mcpFor(s);
    if (!mcp) return c.json({ ...base, ok: false, error: 'non configuré' });
    const t0 = Date.now();
    try {
      // Toujours un vrai contact (deux petites requêtes) : c'est l'état de la connexion qu'on veut voir.
      const tools = await toolsFor(u.id, s, mcp, true);
      return c.json({
        ...base,
        ok: true,
        latencyMs: Date.now() - t0,
        checkedAt: now(),
        tools: tools.map((t) => ({ name: t.name, write: isWriteTool(t) })),
      });
    } catch (e) {
      return c.json({ ...base, ok: false, error: e instanceof McpError ? e.message : 'connexion impossible', checkedAt: now() });
    }
  });

  app.get('/api/interfast/overview', async (c) => {
    const u = c.get('user');
    if (!u) return unauthorized(c);
    const s = await loadSettings(u.id);
    const o = overviews.get(u.id);
    // Gardé 24 h en mémoire : au-delà de 30 min il est « à rafraîchir » (affiché tout de suite, actualisé derrière).
    const usable = o && o.key === `${s.mcp_url}|${s.mcp_key_hint}` && now().getTime() - o.at < 24 * 3600_000;
    return c.json({
      overview: usable ? o.data : null,
      at: usable ? new Date(o.at) : null,
      stale: !usable || now().getTime() - o.at >= OVERVIEW_TTL_MS,
      collecting: collecting.has(u.id),
      assistant: llm !== null,
    });
  });

  /*
   * Collecte du tableau de bord : une TÂCHE qui tourne sur le serveur (09/11/2026 :
   * « network error » — une réponse en flux de plus d'une minute ne survit pas
   * toujours au Wi-Fi, au mode veille ou à un proxy). `POST` la lance et répond
   * tout de suite ; l'écran suit `GET …/progress` chaque seconde : appels
   * Interfast un par un, calcul, estimation d'après la lecture précédente. Une
   * coupure ne perd rien : la tâche continue, l'écran reprend le suivi.
   */
  type JobCall = { id: number; label: string; state: 'en_cours' | 'ok' | 'erreur'; ms?: number };
  type Job = {
    startedAt: number;
    state: 'en_cours' | 'fini' | 'erreur';
    phase: 'interfast' | 'calcul';
    calls: JobCall[];
    calcMs: number;
    calcSince: number | null;
    estimateMs: number | null;
    error?: string;
    endedAt?: number;
  };
  const jobs = new Map<string, Job>();
  type Stats = { ms: number; interfast_ms: number; calcul_ms: number; calls: number; at: string };

  const jobView = (j: Job | undefined) =>
    j && {
      state: j.state,
      phase: j.phase,
      elapsedMs: (j.endedAt ?? Date.now()) - j.startedAt,
      estimateMs: j.estimateMs,
      calls: j.calls,
      calcMs: j.calcMs + (j.calcSince ? Date.now() - j.calcSince : 0),
      error: j.error,
    };

  app.get('/api/interfast/overview/progress', async (c) => {
    const u = c.get('user');
    if (!u) return unauthorized(c);
    const j = jobs.get(u.id);
    const o = overviews.get(u.id);
    return c.json({ job: jobView(j) ?? null, overview: j?.state === 'fini' && o ? o.data : null, at: j?.state === 'fini' && o ? new Date(o.at) : null });
  });

  /** Lance la lecture d'Interfast (lecture seule) et répond aussitôt. */
  app.post('/api/interfast/overview', async (c) => {
    const u = c.get('user');
    if (!u) return unauthorized(c);
    if (!llm || !cfg.anthropic) return c.json({ error: 'assistante non configurée sur le serveur (clé Anthropic absente)' }, 503);
    const s = await loadSettings(u.id);
    const mcp = mcpFor(s);
    if (!mcp) return c.json({ error: 'Interfast n’est pas connecté' }, 400);
    if (collecting.has(u.id)) return c.json({ job: jobView(jobs.get(u.id)) }, 202);
    if (overRate(`overview:${u.id}`, 12, 3600_000)) return c.json({ error: 'trop d’actualisations en une heure, patientez' }, 429);
    collecting.add(u.id);
    const anthropic = cfg.anthropic;
    const prev = (await db.query<{ overview_recipe: RecipeCall[] | null; overview_stats: Stats | null }>('SELECT overview_recipe, overview_stats FROM settings WHERE user_id = $1', [u.id]))[0];
    const job: Job = { startedAt: Date.now(), state: 'en_cours', phase: 'interfast', calls: [], calcMs: 0, calcSince: null, estimateMs: prev?.overview_stats?.ms ?? null };
    jobs.set(u.id, job);

    void (async () => {
      try {
        const tools = await toolsFor(u.id, s, mcp);
        const { overview: data, recipe } = await collectOverview({
          llm,
          model: anthropic.overviewModel,
          // Sonnet 5.5 : pas de réflexion longue pour un calcul de tableau de bord (la vitesse compte).
          thinking: /^claude-sonnet-5-5/.test(anthropic.overviewModel) ? { type: 'between_tools' } : undefined,
          mcp,
          mcpTools: tools,
          recipe: Array.isArray(prev?.overview_recipe) ? prev.overview_recipe : [],
          today: now().toISOString().slice(0, 10),
          onCall: (e) => {
            const k = job.calls.findIndex((x) => x.id === e.id);
            const row = { id: e.id, label: e.label, state: e.state, ms: e.ms };
            if (k >= 0) job.calls[k] = row;
            else job.calls.push(row);
          },
          onCalc: (e) => {
            if (e.state === 'en_cours') {
              job.phase = 'calcul';
              job.calcSince = Date.now();
            } else {
              job.calcMs += e.ms ?? 0;
              job.calcSince = null;
            }
          },
          logTool: async (tool, ok, ms) => {
            await db.query('INSERT INTO tool_log (user_id, tool, ok, ms) VALUES ($1, $2, $3, $4)', [u.id, tool, ok, ms]);
          },
        });
        const at = now().getTime();
        overviews.set(u.id, { at, key: `${s.mcp_url}|${s.mcp_key_hint}`, data });
        job.endedAt = Date.now();
        const total = job.endedAt - job.startedAt;
        // Le temps passé à attendre Interfast : appels en parallèle, donc la plus longue de chaque vague ≈ total − calcul.
        const stats: Stats = { ms: total, calcul_ms: job.calcMs, interfast_ms: Math.max(0, total - job.calcMs), calls: job.calls.length, at: new Date(at).toISOString() };
        await db.query('UPDATE settings SET overview_stats = $2::text::jsonb WHERE user_id = $1', [u.id, JSON.stringify(stats)]);
        if (recipe.length) await db.query('UPDATE settings SET overview_recipe = $2::text::jsonb WHERE user_id = $1', [u.id, JSON.stringify(recipe)]);
        job.state = 'fini';
      } catch (e) {
        console.error('tableau Interfast :', (e as Error).message);
        job.state = 'erreur';
        job.endedAt = Date.now();
        job.error = e instanceof McpError ? e.message : 'La lecture d’Interfast n’a pas abouti. Réessayez dans un instant.';
      } finally {
        collecting.delete(u.id);
      }
    })();
    return c.json({ job: jobView(job) }, 202);
  });

  /* ---------- Tableau de bord ---------- */
  app.get('/api/dashboard', async (c) => {
    const u = c.get('user');
    if (!u) return unauthorized(c);
    const t = now();
    const month = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1));
    const week = new Date(t.getTime() - 7 * 86_400_000);
    const q1 = <T>(sql: string, p: unknown[]) => db.query<T>(sql, p).then((r) => r[0]!);
    const [counts, actions, rexN, tools, recent, s] = await Promise.all([
      q1<{ sessions_month: number; quotes_month: number; waiting: number; avg_rating: number | null }>(
        `SELECT count(*) FILTER (WHERE created_at >= $2)::int AS sessions_month,
                count(*) FILTER (WHERE status = 'devis_cree' AND updated_at >= $2)::int AS quotes_month,
                count(*) FILTER (WHERE pending IS NOT NULL)::int AS waiting,
                round(avg(rating)::numeric, 1)::float AS avg_rating
           FROM conversations WHERE user_id = $1`,
        [u.id, month],
      ),
      q1<{ validated: number; refused: number }>(
        `SELECT count(*) FILTER (WHERE state = 'validee')::int AS validated, count(*) FILTER (WHERE state = 'refusee')::int AS refused FROM actions WHERE user_id = $1 AND created_at >= $2`,
        [u.id, month],
      ),
      q1<{ n: number }>(`SELECT count(*)::int AS n FROM rex WHERE user_id = $1 AND kind <> 'avis'`, [u.id]),
      q1<{ calls: number; errors: number; avg_ms: number | null }>(
        `SELECT count(*)::int AS calls, count(*) FILTER (WHERE NOT ok)::int AS errors, round(avg(ms))::int AS avg_ms FROM tool_log WHERE user_id = $1 AND created_at >= $2`,
        [u.id, week],
      ),
      db.query(`SELECT id, title, status, outcome, (pending IS NOT NULL) AS waiting, updated_at FROM conversations WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 6`, [u.id]),
      loadSettings(u.id),
    ]);
    return c.json({
      ...counts,
      ...actions,
      rex: rexN.n,
      interfast: { configured: !!s.mcp_url, calls_week: tools.calls, errors_week: tools.errors, avg_ms: tools.avg_ms },
      assistant: llm !== null,
      profile_complete: !!(s.company && s.trade && s.hourly_rate !== null),
      recent,
    });
  });

  return app;
}
