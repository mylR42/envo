/** Comptes : inscription par code, double authentification, mot de passe oublié, anti-CSRF. */
import { describe, expect, it } from 'vitest';
import { client, ORIGIN, setup, signedIn } from './helpers';

const codeOf = (subject: string) => /(\d{6})/.exec(subject)![1]!;

describe('comptes', () => {
  it('santé : chaîne exacte attendue par le déploiement', async () => {
    const env = await setup();
    const res = await env.app.request(`${ORIGIN}/api/health`);
    expect(await res.text()).toBe('{"db":true,"commit":"abc123"}');
  });

  it('inscription en deux temps : le compte n’existe qu’après le code', async () => {
    const env = await setup();
    const c = client(env.app);
    const r = await c.call('POST', '/api/auth/register', { email: 'Paul@Example.fr', password: 'motdepasse-solide', name: 'Paul' });
    expect(r.status).toBe(200);
    expect((await env.db.query('SELECT 1 FROM users')).length).toBe(0);
    expect(env.sent[0]!.to).toBe('paul@example.fr');
    expect((await c.call('POST', '/api/auth/verify', { email: 'paul@example.fr', code: '000000' })).status).toBe(400);
    const ok = await c.call('POST', '/api/auth/verify', { email: 'paul@example.fr', code: codeOf(env.sent[0]!.subject) });
    expect(ok.status).toBe(200);
    expect((await c.call('GET', '/api/auth/me')).json.user.email).toBe('paul@example.fr');
  });

  it('une adresse déjà inscrite reçoit la même réponse, sans code', async () => {
    const env = await setup();
    await signedIn(env, 'a@example.fr');
    const n = env.sent.length;
    const r = await client(env.app).call('POST', '/api/auth/register', { email: 'a@example.fr', password: 'autre-mot-de-passe' });
    expect(r).toMatchObject({ status: 200, json: { ok: true } });
    expect(env.sent.length).toBe(n);
  });

  it('connexion : le mot de passe seul n’ouvre rien, il faut le code e-mail', async () => {
    const env = await setup();
    await signedIn(env, 'a@example.fr');
    const c = client(env.app);
    expect((await c.call('POST', '/api/auth/login', { email: 'a@example.fr', password: 'mauvais' })).status).toBe(401);
    const r = await c.call('POST', '/api/auth/login', { email: 'a@example.fr', password: 'motdepasse-solide' });
    expect(r.json.second).toBeTruthy();
    expect(c.cookie).toBe('');
    expect((await c.call('GET', '/api/auth/me')).json.user).toBeNull();
    const code = codeOf(env.sent.at(-1)!.subject);
    expect((await c.call('POST', '/api/auth/second/verify', { second: r.json.second, code })).status).toBe(200);
    expect((await c.call('GET', '/api/auth/me')).json.user.email).toBe('a@example.fr');
    // Usage unique.
    expect((await c.call('POST', '/api/auth/second/verify', { second: r.json.second, code })).status).toBe(400);
  });

  it('10 échecs de connexion = pause', async () => {
    const env = await setup();
    await signedIn(env, 'a@example.fr');
    const c = client(env.app);
    for (let i = 0; i < 10; i++) await c.call('POST', '/api/auth/login', { email: 'a@example.fr', password: 'x' });
    expect((await c.call('POST', '/api/auth/login', { email: 'a@example.fr', password: 'motdepasse-solide' })).status).toBe(429);
  });

  it('mot de passe oublié : même réponse pour une adresse inconnue, réinitialisation par code', async () => {
    const env = await setup();
    await signedIn(env, 'a@example.fr');
    const n = env.sent.length;
    const unknown = await client(env.app).call('POST', '/api/auth/forgot', { email: 'inconnu@example.fr' });
    expect(unknown.json.reset).toBeTruthy();
    expect(env.sent.length).toBe(n);
    const c = client(env.app);
    const r = await c.call('POST', '/api/auth/forgot', { email: 'a@example.fr' });
    const code = codeOf(env.sent.at(-1)!.subject);
    expect((await c.call('POST', '/api/auth/reset', { reset: r.json.reset, code, password: 'nouveau-mot-de-passe' })).status).toBe(200);
    const again = await client(env.app).call('POST', '/api/auth/login', { email: 'a@example.fr', password: 'nouveau-mot-de-passe' });
    expect(again.json.second).toBeTruthy();
  });

  it('anti-CSRF : une écriture d’une autre origine est refusée', async () => {
    const env = await setup();
    const c = client(env.app);
    const r = await c.call('POST', '/api/auth/login', { email: 'a@example.fr', password: 'x' }, { origin: 'https://pirate.example' });
    expect(r.status).toBe(403);
  });

  it('changer son mot de passe : l’actuel est redemandé, une alerte part', async () => {
    const env = await setup();
    const c = await signedIn(env);
    expect((await c.call('POST', '/api/account/password', { current: 'faux', password: 'nouveau-mot-de-passe' })).status).toBe(400);
    expect((await c.call('POST', '/api/account/password', { current: 'motdepasse-solide', password: 'nouveau-mot-de-passe' })).status).toBe(200);
    expect(env.sent.at(-1)!.subject).toMatch(/Alerte de sécurité/);
  });

  it('sans session, les données sont fermées', async () => {
    const env = await setup();
    const c = client(env.app);
    for (const p of ['/api/settings', '/api/rex', '/api/conversations', '/api/dashboard']) expect((await c.call('GET', p)).status).toBe(401);
  });
});
