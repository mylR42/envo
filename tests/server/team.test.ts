/**
 * Plusieurs utilisateurs par entreprise : Interfast, réglages et mémoire
 * partagés ; séances personnelles ; rôles ; invitations à usage unique ;
 * au moins un administrateur ; un membre retiré ne garde rien de l'entreprise.
 */
import { describe, expect, it } from 'vitest';
import { client, MCP_URL, setup, signedIn } from './helpers';

type Env = Awaited<ReturnType<typeof setup>>;

/** Invite `email` et rend le lien (pris dans l'e-mail « envoyé »). */
async function invite(env: Env, admin: ReturnType<typeof client>, email: string, role = 'membre') {
  const r = await admin.call('POST', '/api/team/invitations', { email, role });
  expect(r.status).toBe(200);
  const mail = env.sent.at(-1)!;
  expect(mail.to).toBe(email);
  return /#\/rejoindre\/([A-Za-z0-9_-]+)/.exec(mail.text)![1]!;
}

describe('équipe', () => {
  it('un invité rejoint : réglages, Interfast et mémoire partagés ; séances personnelles ; droits', async () => {
    const env = await setup();
    const boss = await signedIn(env, 'patron@example.fr');
    await boss.call('PUT', '/api/settings', { company: 'Dupont Plomberie', hourly_rate: 50, mcp_url: MCP_URL, mcp_key: 'cle-secrete' });
    await boss.call('POST', '/api/rex', { kind: 'tarif', content: 'Déplacement 35 € HT.' });
    const conv = (await boss.call('POST', '/api/conversations')).json.id;

    const token = await invite(env, boss, 'secretaire@example.fr');
    const sec = client(env.app);
    const view = await sec.call('GET', `/api/team/join/${token}`);
    expect(view.json).toMatchObject({ email: 'secretaire@example.fr', company: 'Dupont Plomberie', role: 'membre', account: false });
    expect((await sec.call('POST', '/api/team/join', { token, name: 'Léa', password: 'court' })).status).toBe(400);
    const j = await sec.call('POST', '/api/team/join', { token, name: 'Léa', password: 'motdepasse-solide' });
    expect(j.status).toBe(200);
    expect(j.json.user.role).toBe('membre');
    // Le lien ne sert qu'une fois.
    expect((await client(env.app).call('POST', '/api/team/join', { token, password: 'motdepasse-solide' })).status).toBe(404);

    const st = (await sec.call('GET', '/api/settings')).json;
    expect(st.settings).toMatchObject({ company: 'Dupont Plomberie', hourly_rate: 50, mcp: { configured: true } });
    expect(st.role).toBe('membre');
    expect((await sec.call('GET', '/api/rex')).json.rex.map((r: { content: string }) => r.content)).toEqual(['Déplacement 35 € HT.']);
    // Séances : chacun les siennes.
    expect((await sec.call('GET', '/api/conversations')).json.conversations).toEqual([]);
    expect((await sec.call('GET', `/api/conversations/${conv}`)).status).toBe(404);
    // Un membre ne touche ni aux réglages de l'entreprise, ni à l'équipe ; son nom et sa voix, si.
    expect((await sec.call('PUT', '/api/settings', { hourly_rate: 1 })).status).toBe(403);
    expect((await sec.call('PUT', '/api/settings', { mcp_url: '' })).status).toBe(403);
    expect((await sec.call('PUT', '/api/settings', { name: 'Léa M.', voice_reply: true })).json.settings.voice_reply).toBe(true);
    expect((await boss.call('GET', '/api/settings')).json.settings.voice_reply).toBe(false);
    expect((await sec.call('POST', '/api/team/invitations', { email: 'x@example.fr' })).status).toBe(403);
    // La mémoire écrite par un membre est celle de l'équipe.
    await sec.call('POST', '/api/rex', { kind: 'client', content: 'M. Petit paie à 30 jours.' });
    expect((await boss.call('GET', '/api/rex')).json.rex).toHaveLength(2);

    const team = (await boss.call('GET', '/api/team')).json;
    expect(team.members.map((m: { email: string; role: string }) => [m.email, m.role])).toEqual([
      ['patron@example.fr', 'admin'],
      ['secretaire@example.fr', 'membre'],
    ]);
    expect((await sec.call('GET', '/api/team')).json.invitations).toEqual([]);
  });

  it('toujours un administrateur ; un membre retiré repart seul, sans les séances de l’entreprise', async () => {
    const env = await setup();
    const boss = await signedIn(env, 'patron@example.fr');
    await boss.call('PUT', '/api/settings', { company: 'Dupont Plomberie', mcp_url: MCP_URL, mcp_key: 'cle-secrete' });
    const token = await invite(env, boss, 'chef@example.fr', 'admin');
    const chef = client(env.app);
    await chef.call('POST', '/api/team/join', { token, name: 'Chef', password: 'motdepasse-solide' });
    await chef.call('POST', '/api/conversations');
    const ids = (await boss.call('GET', '/api/team')).json.members.map((m: { id: string; email: string }) => m);
    const bossId = ids.find((m: { email: string }) => m.email === 'patron@example.fr').id;
    const chefId = ids.find((m: { email: string }) => m.email === 'chef@example.fr').id;

    // Le chef (admin) rétrograde le patron, puis ne peut pas se rétrograder lui-même : dernier admin.
    expect((await chef.call('PATCH', `/api/team/members/${bossId}`, { role: 'membre' })).status).toBe(200);
    expect((await chef.call('PATCH', `/api/team/members/${chefId}`, { role: 'membre' })).status).toBe(409);
    expect((await chef.call('DELETE', `/api/team/members/${chefId}`)).status).toBe(409);
    expect((await boss.call('DELETE', `/api/team/members/${chefId}`)).status).toBe(403);
    await chef.call('PATCH', `/api/team/members/${bossId}`, { role: 'admin' });

    // Le patron retire le chef : séances supprimées, déconnecté, entreprise vide.
    expect((await boss.call('DELETE', `/api/team/members/${chefId}`)).status).toBe(200);
    expect((await chef.call('GET', '/api/auth/me')).json.user).toBeNull();
    expect((await env.db.query('SELECT 1 FROM conversations WHERE user_id = $1', [chefId])).length).toBe(0);
    const again = client(env.app);
    await again.call('POST', '/api/auth/login', { email: 'chef@example.fr', password: 'motdepasse-solide' });
    const second = (await again.call('POST', '/api/auth/login', { email: 'chef@example.fr', password: 'motdepasse-solide' })).json.second;
    const code = /(\d{6})/.exec(env.sent.at(-1)!.subject)![1];
    await again.call('POST', '/api/auth/second/verify', { second, code });
    const s = (await again.call('GET', '/api/settings')).json;
    expect(s.settings).toMatchObject({ company: '', mcp: { configured: false } });
    expect(s.role).toBe('admin');
  });

  it('un compte existant rejoint connecté sur la bonne adresse ; son entreprise vide disparaît', async () => {
    const env = await setup();
    const boss = await signedIn(env, 'patron@example.fr');
    await boss.call('PUT', '/api/settings', { company: 'Dupont Plomberie' });
    const solo = await signedIn(env, 'solo@example.fr');
    await solo.call('PUT', '/api/settings', { company: 'Solo SARL' });
    const intruder = await signedIn(env, 'autre@example.fr');
    const token = await invite(env, boss, 'solo@example.fr');

    expect((await client(env.app).call('POST', '/api/team/join', { token })).json.login).toBe(true);
    expect((await intruder.call('POST', '/api/team/join', { token })).status).toBe(403);
    expect((await solo.call('POST', '/api/team/join', { token })).status).toBe(200);
    expect((await solo.call('GET', '/api/settings')).json.settings.company).toBe('Dupont Plomberie');
    expect((await env.db.query(`SELECT 1 FROM settings WHERE company = 'Solo SARL'`)).length).toBe(0);
  });
});
