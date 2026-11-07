/**
 * L'assistante de bout en bout : réglages Interfast (clé chiffrée), faux Claude
 * qui joue un scénario, VRAI client MCP contre un faux serveur Interfast.
 *
 * Ce que ces tests ancrent :
 * - une LECTURE Interfast part toute seule ;
 * - une ÉCRITURE n'est jamais exécutée sans le « Valider » de l'artisan, et part
 *   avec les arguments exacts qui lui ont été montrés ;
 * - un refus n'exécute rien ;
 * - questions à choix, brouillon et REX ;
 * - le contexte d'une séance (réglages, REX) est figé et rejoué tel quel.
 */
import { describe, expect, it } from 'vitest';
import { MCP_URL, setup, signedIn } from './helpers';

const connect = async (c: Awaited<ReturnType<typeof signedIn>>) =>
  c.call('PUT', '/api/settings', { mcp_url: MCP_URL, mcp_key: 'cle-secrete', company: 'Dupont Plomberie', trade: 'plombier', hourly_rate: '48,5', vat_rate: 10 });

describe('réglages et connexion Interfast', () => {
  it('la clé est chiffrée en base et ne repart jamais au navigateur', async () => {
    const env = await setup();
    const c = await signedIn(env);
    const r = await connect(c);
    expect(r.status).toBe(200);
    expect(r.json.settings.mcp).toEqual({ url: MCP_URL, keyHint: '••••rete', configured: true });
    expect(r.json.settings.hourly_rate).toBe(48.5);
    expect(JSON.stringify(r.json)).not.toContain('cle-secrete');
    const row = (await env.db.query<{ mcp_key_enc: string }>('SELECT mcp_key_enc FROM settings'))[0]!;
    expect(row.mcp_key_enc).toMatch(/^v1\./);
    expect(row.mcp_key_enc).not.toContain('cle-secrete');
  });

  it('test de connexion : liste les outils, lecture ou écriture', async () => {
    const env = await setup();
    const c = await signedIn(env);
    await connect(c);
    const r = await c.call('POST', '/api/settings/test');
    expect(r.json.ok).toBe(true);
    expect(r.json.tools.map((t: { name: string; write: boolean }) => [t.name, t.write])).toEqual([
      ['search_customers', false],
      ['list_quotes', false],
      ['create_quote', true],
    ]);
  });

  it('une mauvaise clé est dite clairement', async () => {
    const env = await setup();
    const c = await signedIn(env);
    await c.call('PUT', '/api/settings', { mcp_url: MCP_URL, mcp_key: 'fausse' });
    const r = await c.call('POST', '/api/settings/test');
    expect(r.json).toMatchObject({ ok: false });
    expect(r.json.error).toMatch(/refuse la clé/);
  });

  it('refuse une URL qui ferait appeler le réseau interne du serveur', async () => {
    const env = await setup();
    const c = await signedIn(env);
    for (const url of ['http://mcp.interfast.fr/x', 'https://localhost/x', 'https://127.0.0.1/x', 'https://192.168.1.5/x', 'https://[::1]/x', 'https://intranet/x', 'https://u:p@mcp.interfast.fr/'])
      expect((await c.call('PUT', '/api/settings', { mcp_url: url })).status, url).toBe(400);
  });
});

describe('AssistDevis', () => {
  it('scénario complet : recherche client, question à choix, brouillon, validation, création, mémoire', async () => {
    const env = await setup({
      script: [
        // 1. Cherche le client (lecture : part toute seule) et le REX.
        [
          { type: 'text', text: 'Je regarde dans Interfast.' },
          { type: 'tool_use', id: 'tu_1', name: 'if_search_customers', input: { query: 'Dupont' } },
          { type: 'tool_use', id: 'tu_2', name: 'rechercher_rex', input: { requete: 'chauffe-eau' } },
        ],
        // 2. Pose une question à choix.
        [{ type: 'tool_use', id: 'tu_3', name: 'proposer_choix', input: { question: 'Quelle capacité ?', options: ['150 L', '200 L', '300 L'] } }],
        // 3. Brouillon, puis demande de création (écriture : attend l'artisan).
        [
          { type: 'tool_use', id: 'tu_4', name: 'afficher_brouillon', input: { titre: 'Chauffe-eau 200 L', client: 'Martin Dupont', lignes: [{ designation: 'Chauffe-eau 200 L', quantite: 1, prix_unitaire_ht: 690, tva: 10 }] } },
          { type: 'tool_use', id: 'tu_5', name: 'if_create_quote', input: { customer_id: 'c-42', lines: [{ label: 'Chauffe-eau 200 L', qty: 1, unit_price: 690 }] } },
        ],
        // 4. Après validation : mémorise et conclut.
        [
          { type: 'tool_use', id: 'tu_6', name: 'memoriser', input: { type: 'tarif', contenu: 'Chauffe-eau 200 L posé : 690 € HT.', mots_cles: 'chauffe-eau' } },
        ],
        [{ type: 'text', text: 'Le devis D-2026-0099 est créé dans Interfast.' }],
      ],
    });
    const c = await signedIn(env);
    await connect(c);
    await c.call('POST', '/api/rex', { kind: 'preference', content: 'Toujours proposer le groupe de sécurité neuf avec un chauffe-eau.' });
    const conv = (await c.call('POST', '/api/conversations')).json.id as string;

    // Tour 1 : lecture automatique, puis question en attente.
    const t1 = await c.call('POST', `/api/conversations/${conv}/turn`, { text: 'Devis chauffe-eau pour M. Dupont' });
    expect(t1.status).toBe(200);
    expect(env.interfast.calls.map((x) => x.name)).toEqual(['search_customers']);
    expect(env.interfast.calls[0]!.auth).toBe('Bearer cle-secrete');
    expect(t1.json.waiting).toEqual([{ id: 'tu_3', kind: 'choice' }]);
    const choice = t1.json.items.find((i: { type: string }) => i.type === 'choice');
    expect(choice).toMatchObject({ question: 'Quelle capacité ?', options: ['150 L', '200 L', '300 L'], open: true });
    expect(t1.json.items.find((i: { type: string }) => i.type === 'lookup')).toMatchObject({ tool: 'search_customers', ok: true });
    expect(t1.json._events.some((e: { event: string; data: string }) => e.event === 'status' && /Interfast/.test(e.data))).toBe(true);
    // Le REX est retrouvé par l'outil de recherche.
    const second = env.scripted.requests[1]!;
    const lastUser = second.messages.at(-1)!;
    expect(JSON.stringify(lastUser.content)).toContain('groupe de sécurité');

    // Tour 2 : réponse au choix -> brouillon + écriture EN ATTENTE, rien d'exécuté.
    const t2 = await c.call('POST', `/api/conversations/${conv}/turn`, { answers: [{ toolUseId: 'tu_3', choice: '200 L' }] });
    expect(t2.json.waiting).toEqual([{ id: 'tu_5', kind: 'confirm' }]);
    expect(env.interfast.calls.map((x) => x.name)).toEqual(['search_customers']);
    expect(t2.json.items.find((i: { type: string }) => i.type === 'draft')).toMatchObject({ titre: 'Chauffe-eau 200 L', lignes: [{ prix_unitaire_ht: 690 }] });
    expect(t2.json.items.find((i: { type: string }) => i.type === 'confirm')).toMatchObject({ tool: 'create_quote', state: 'attente' });
    expect(t2.json.items.find((i: { type: string }) => i.type === 'answer')).toMatchObject({ text: '200 L' });
    // La réponse au choix revient comme tool_result de la question, dans UN message.
    const req = env.scripted.requests[2]!;
    const results = (req.messages.at(-1)!.content as { type: string }[]).filter((b) => b.type === 'tool_result');
    expect(results.length).toBe(1);

    // Tour 3 : validation -> l'écriture part avec les arguments montrés.
    const t3 = await c.call('POST', `/api/conversations/${conv}/turn`, { answers: [{ toolUseId: 'tu_5', approved: true }] });
    expect(env.interfast.calls.at(-1)).toMatchObject({ name: 'create_quote', args: { customer_id: 'c-42', lines: [{ label: 'Chauffe-eau 200 L', qty: 1, unit_price: 690 }] } });
    expect(t3.json.waiting).toEqual([]);
    expect(t3.json.conversation.status).toBe('devis_cree');
    expect(t3.json.conversation.outcome).toContain('D-2026-0099');
    expect(t3.json.items.find((i: { type: string }) => i.type === 'confirm')).toMatchObject({ state: 'validee' });
    expect(t3.json.items.at(-1)).toMatchObject({ type: 'assistant', text: 'Le devis D-2026-0099 est créé dans Interfast.' });
    // La décision est mémorisée.
    const rex = await c.call('GET', '/api/rex');
    expect(rex.json.rex.map((r: { content: string }) => r.content)).toContain('Chauffe-eau 200 L posé : 690 € HT.');

    // Le contexte figé (réglages + REX) est le même à chaque requête : le cache tient.
    const systems = env.scripted.requests.map((r) => JSON.stringify(r.system));
    expect(new Set(systems).size).toBe(1);
    expect(systems[0]).toContain('48.5 € HT');
    expect(systems[0]).toContain('groupe de sécurité');
    // Historique en ajout seul : chaque requête prolonge la précédente.
    for (let i = 1; i < env.scripted.requests.length; i++) {
      const prev = env.scripted.requests[i - 1]!.messages;
      expect(env.scripted.requests[i]!.messages.slice(0, prev.length)).toEqual(prev);
    }
    // Pas de choix d'outil forcé (refusé par le modèle) ; outils triés et stables.
    expect(env.scripted.requests.every((r) => (r.tool_choice as { type: string }).type === 'auto')).toBe(true);
    const names = env.scripted.requests[0]!.tools!.map((t) => (t as { name: string }).name);
    expect(names).toEqual(['proposer_choix', 'afficher_brouillon', 'memoriser', 'rechercher_rex', 'if_create_quote', 'if_list_quotes', 'if_search_customers']);

    // Le tableau de bord le compte.
    const d = await c.call('GET', '/api/dashboard');
    expect(d.json).toMatchObject({ quotes_month: 1, validated: 1, rex: 2, waiting: 0, interfast: { configured: true, calls_week: 2, errors_week: 0 } });
  });

  it('un refus n’exécute rien et le dit à l’assistante', async () => {
    const env = await setup({
      script: [[{ type: 'tool_use', id: 'w1', name: 'if_create_quote', input: { customer_id: 'c-42' } }], [{ type: 'text', text: 'Entendu, je n’ai rien créé.' }]],
    });
    const c = await signedIn(env);
    await connect(c);
    const conv = (await c.call('POST', '/api/conversations')).json.id as string;
    await c.call('POST', `/api/conversations/${conv}/turn`, { text: 'Crée le devis' });
    const t = await c.call('POST', `/api/conversations/${conv}/turn`, { answers: [{ toolUseId: 'w1', approved: false }] });
    expect(env.interfast.calls).toEqual([]);
    expect(t.json.items.find((i: { type: string }) => i.type === 'confirm')).toMatchObject({ state: 'refusee' });
    expect(JSON.stringify(env.scripted.requests[1]!.messages.at(-1))).toContain('REFUSÉ');
  });

  it('un message tapé pendant une validation n’exécute pas l’écriture', async () => {
    const env = await setup({
      script: [[{ type: 'tool_use', id: 'w1', name: 'if_create_quote', input: { customer_id: 'c-42' } }], [{ type: 'text', text: 'Je corrige.' }]],
    });
    const c = await signedIn(env);
    await connect(c);
    const conv = (await c.call('POST', '/api/conversations')).json.id as string;
    await c.call('POST', `/api/conversations/${conv}/turn`, { text: 'Crée le devis' });
    await c.call('POST', `/api/conversations/${conv}/turn`, { text: 'Attends, mets 2 unités' });
    expect(env.interfast.calls).toEqual([]);
    const last = JSON.stringify(env.scripted.requests[1]!.messages.at(-1));
    expect(last).toContain('pas validé');
    expect(last).toContain('mets 2 unités');
  });

  it('une séance d’un autre compte est introuvable', async () => {
    const env = await setup();
    const a = await signedIn(env, 'a@example.fr');
    const b = await signedIn(env, 'b@example.fr');
    const conv = (await a.call('POST', '/api/conversations')).json.id as string;
    expect((await b.call('GET', `/api/conversations/${conv}`)).status).toBe(404);
    expect((await b.call('POST', `/api/conversations/${conv}/turn`, { text: 'salut' })).status).toBe(404);
  });

  it('sans Interfast, l’assistante le sait ; sans clé Anthropic, l’API le dit', async () => {
    const env = await setup({ script: [[{ type: 'text', text: 'Interfast n’est pas connecté.' }]] });
    const c = await signedIn(env);
    const conv = (await c.call('POST', '/api/conversations')).json.id as string;
    await c.call('POST', `/api/conversations/${conv}/turn`, { text: 'Bonjour' });
    expect(JSON.stringify(env.scripted.requests[0]!.system)).toContain('NON CONNECTÉ');
    expect(env.scripted.requests[0]!.tools!.length).toBe(4);

    const off = await setup({ anthropic: false });
    const c2 = await signedIn(off);
    const conv2 = (await c2.call('POST', '/api/conversations')).json.id as string;
    expect((await c2.call('POST', `/api/conversations/${conv2}/turn`, { text: 'Bonjour' })).status).toBe(503);
  });

  it('fin de séance : la note et l’avis deviennent du REX pour les séances suivantes', async () => {
    const env = await setup({ script: [[{ type: 'text', text: 'Bonjour !' }], [{ type: 'text', text: 'Re-bonjour.' }]] });
    const c = await signedIn(env);
    const conv = (await c.call('POST', '/api/conversations')).json.id as string;
    await c.call('POST', `/api/conversations/${conv}/turn`, { text: 'Bonjour' });
    await c.call('POST', `/api/conversations/${conv}/close`, { rating: 4, feedback: 'Pose moins de questions sur la TVA, c’est toujours 10 %.' });
    const conv2 = (await c.call('POST', '/api/conversations')).json.id as string;
    await c.call('POST', `/api/conversations/${conv2}/turn`, { text: 'Nouveau devis' });
    const sys = JSON.stringify(env.scripted.requests[1]!.system);
    expect(sys).toContain('Pose moins de questions sur la TVA');
    expect(sys).toContain('note 4/5');
  });
});
