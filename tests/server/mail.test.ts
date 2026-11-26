/**
 * Gmail : brancher (mot de passe ESSAYÉ avant d'être gardé, chiffré, personnel),
 * chercher et lire par l'assistante, et ⚠️ AUCUN ENVOI SANS « VALIDER ».
 */
import { describe, expect, it } from 'vitest';
import { setup, signedIn } from './helpers';

const PASS = 'abcd efgh ijkl mnop';

describe('Gmail', () => {
  it('branchement : essayé avant d’être gardé, chiffré, à soi seul', async () => {
    const env = await setup();
    const c = await signedIn(env);
    expect((await c.call('GET', '/api/mail')).json.configured).toBe(false);
    const bad = await c.call('PUT', '/api/mail', { email: 'paul@gmail.com', password: 'mauvais-mot-de-passe' });
    expect(bad.status).toBe(400);
    expect(bad.json.error).toContain('mot de passe d’application');
    expect((await env.db.query('SELECT 1 FROM mail_accounts')).length).toBe(0);

    const ok = await c.call('PUT', '/api/mail', { email: 'Paul@Gmail.com', password: PASS });
    expect(ok.json).toMatchObject({ configured: true, email: 'paul@gmail.com' });
    // Espaces retirés (Google affiche le mot de passe par blocs de 4) ; jamais en clair en base ni à l'écran.
    expect(env.gmail.logins.at(-1)).toEqual({ email: 'paul@gmail.com', pass: 'abcdefghijklmnop' });
    expect(JSON.stringify(await env.db.query('SELECT * FROM mail_accounts'))).not.toContain('abcdefghijklmnop');
    expect(JSON.stringify(ok.json)).not.toContain('abcdefghijklmnop');
    expect((await c.call('POST', '/api/mail/test')).json).toMatchObject({ ok: true, unread: 1 });
    expect((await c.call('GET', '/api/dashboard')).json.mail).toBe(true);

    // Personnel : un collègue de la même équipe ne le voit pas.
    const other = await signedIn(env, 'autre@example.fr');
    expect((await other.call('GET', '/api/mail')).json.configured).toBe(false);

    expect((await c.call('DELETE', '/api/mail')).json.configured).toBe(false);
    expect((await env.db.query('SELECT 1 FROM mail_accounts')).length).toBe(0);
  });

  it('sans Gmail branché, les outils mail_* n’existent pas pour l’assistante', async () => {
    const env = await setup({ script: [[{ type: 'text', text: 'Gmail n’est pas branché.' }]] });
    const c = await signedIn(env);
    const conv = (await c.call('POST', '/api/conversations')).json.id as string;
    await c.call('POST', `/api/conversations/${conv}/turn`, { text: 'Mes mails ?' });
    expect(env.scripted.requests[0]!.tools!.map((t) => (t as { name: string }).name).filter((n) => n.startsWith('mail_'))).toEqual([]);
  });

  it('l’assistante cherche et lit ; l’envoi attend « Valider », le refus n’envoie rien', async () => {
    const env = await setup({
      script: [
        [
          { type: 'tool_use', id: 'm1', name: 'mail_chercher', input: { non_lus: true } },
          { type: 'tool_use', id: 'm2', name: 'mail_lire', input: { id: '41' } },
        ],
        [
          { type: 'text', text: 'Mme Leroy demande si vous passez jeudi à 14 h. Je lui réponds oui ?' },
          { type: 'tool_use', id: 'm3', name: 'mail_envoyer', input: { a: 'leroy@example.fr', objet: 'Re: Devis pompe à chaleur', texte: 'Bonjour,\nJe passe jeudi à 14 h.\nPaul', en_reponse_a: '41' } },
        ],
        [{ type: 'text', text: 'Bien, je n’envoie rien.' }],
        [{ type: 'tool_use', id: 'm4', name: 'mail_envoyer', input: { a: 'leroy@example.fr', objet: 'Re: Devis', texte: 'Jeudi 14 h, c’est noté.', en_reponse_a: '41' } }],
        [{ type: 'text', text: 'C’est envoyé.' }],
      ],
    });
    const c = await signedIn(env);
    await c.call('PUT', '/api/mail', { email: 'paul@gmail.com', password: PASS });
    const conv = (await c.call('POST', '/api/conversations')).json.id as string;

    const t1 = await c.call('POST', `/api/conversations/${conv}/turn`, { text: 'Ai-je des mails non lus ?' });
    const names = env.scripted.requests[0]!.tools!.map((t) => (t as { name: string }).name);
    expect(names).toEqual(expect.arrayContaining(['mail_chercher', 'mail_lire', 'mail_brouillon', 'mail_envoyer']));
    // Le contenu d'un e-mail est balisé comme donnée non fiable.
    const results = JSON.stringify(env.scripted.requests[1]!.messages.at(-1));
    expect(results).toContain('Devis pompe à chaleur');
    expect(results).toContain('email_non_fiable');
    // L'envoi est EN ATTENTE : rien n'est parti.
    expect(t1.json.waiting).toEqual([{ id: 'm3', kind: 'confirm' }]);
    expect(t1.json.items.find((i: { type: string }) => i.type === 'confirm')).toMatchObject({ tool: 'mail_envoyer', state: 'attente', input: { a: 'leroy@example.fr' } });
    expect(env.gmail.sent).toEqual([]);

    // Un message tapé pendant l'attente n'envoie pas.
    await c.call('POST', `/api/conversations/${conv}/turn`, { text: 'Non attends' });
    expect(env.gmail.sent).toEqual([]);

    // Nouvelle proposition, validée : part avec les arguments EXACTS montrés.
    const t3 = await c.call('POST', `/api/conversations/${conv}/turn`, { text: 'Réponds-lui que c’est noté' });
    expect(t3.json.waiting).toEqual([{ id: 'm4', kind: 'confirm' }]);
    const t4 = await c.call('POST', `/api/conversations/${conv}/turn`, { answers: [{ toolUseId: 'm4', approved: true }] });
    expect(env.gmail.sent).toEqual([{ a: 'leroy@example.fr', objet: 'Re: Devis', texte: 'Jeudi 14 h, c’est noté.', en_reponse_a: '41' }]);
    expect(t4.json.items.filter((i: { type: string }) => i.type === 'confirm').map((i: { state: string }) => i.state)).toEqual(['refusee', 'validee']);
  });
});
