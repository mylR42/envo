/**
 * Tableau de bord Interfast : collecte en LECTURE SEULE, résultat en mémoire,
 * rien d'inventé, état de la connexion.
 */
import { describe, expect, it } from 'vitest';
import { sanitize } from '../../server/overview';
import { collectOverview, MCP_URL, setup, signedIn } from './helpers';

const PUBLISHED = {
  series: {
    ca_mensuel: [{ mois: '2026-10', montant_ht: 9000 }, { mois: '2026-11', montant_ht: 905 }],
    devis_mensuels: [{ mois: '2026-11', en_attente: 1450, acceptes: 0, refuses: null }],
    pipeline: [{ statut: 'envoyé', nombre: 1, montant_ht: 1450 }],
    impayes_anciennete: [],
  },
  kpis: [
    { cle: 'devis_en_attente', libelle: 'Devis en attente', valeur: 1, unite: 'nombre', detail: '' },
    { cle: 'ca_facture_mois', libelle: 'CA facturé ce mois', valeur: null, unite: 'eur', detail: 'non fourni' },
  ],
  devis_a_relancer: [{ ref: 'D-2026-0012', client: 'Martin Dupont', objet: 'Chauffe-eau', montant_ht: 1450, date: '2026-10-20', statut: 'envoyé', jours: 18 }],
  derniers_devis: [],
  factures_impayees: [],
  a_venir: [],
  manques: ['Interfast ne fournit pas les factures.'],
  resume: 'Un devis à relancer.',
};

describe('tableau de bord Interfast', () => {
  it('collecte en lecture seule, garde le résultat 30 min en mémoire', async () => {
    const env = await setup({
      script: [
        [{ type: 'tool_use', id: 'o1', name: 'if_list_quotes', input: {} }],
        [{ type: 'tool_use', id: 'o2', name: 'publier_tableau', input: PUBLISHED }],
      ],
    });
    const c = await signedIn(env);
    await c.call('PUT', '/api/settings', { mcp_url: MCP_URL, mcp_key: 'cle-secrete' });
    expect((await c.call('GET', '/api/interfast/overview')).json.overview).toBeNull();

    const r = await collectOverview(c);
    expect(r.status).toBe(200);
    expect(r.json.overview.devis_a_relancer[0]).toMatchObject({ ref: 'D-2026-0012', montant_ht: 1450 });
    expect(r.json.overview.kpis[1].valeur).toBeNull();
    expect(r.json.overview.sources).toEqual(['list_quotes']);
    // ⚠️ Aucun outil d'écriture proposé au modèle.
    const names = env.scripted.requests[0]!.tools!.map((t) => (t as { name: string }).name);
    expect(names).toEqual(['if_list_quotes', 'if_search_customers', 'publier_tableau']);
    expect(env.interfast.calls.map((x) => x.name)).toEqual(['list_quotes']);

    // En mémoire : relu sans nouvel appel à Claude ; rien en base.
    const again = await c.call('GET', '/api/interfast/overview');
    expect(again.json.overview.resume).toBe('Un devis à relancer.');
    expect(env.scripted.calls).toBe(2);
    expect(JSON.stringify(await env.db.query('SELECT * FROM conversations'))).not.toContain('D-2026-0012');
    expect(again.json.stale).toBe(false);
    // Au-delà de 30 minutes : toujours servi (affichage immédiat) mais « à rafraîchir » ; au-delà de 24 h, plus rien.
    env.clock.t = new Date(env.clock.t.getTime() + 31 * 60_000);
    const old = await c.call('GET', '/api/interfast/overview');
    expect(old.json.overview).not.toBeNull();
    expect(old.json.stale).toBe(true);
    env.clock.t = new Date(env.clock.t.getTime() + 24 * 3600_000);
    expect((await c.call('GET', '/api/interfast/overview')).json.overview).toBeNull();
  });

  it('la recette : la collecte suivante rejoue les appels d’emblée, en un seul passage de Claude', async () => {
    const env = await setup({
      script: [
        [{ type: 'tool_use', id: 'r1', name: 'if_list_quotes', input: { status: 'sent' } }],
        [{ type: 'tool_use', id: 'r2', name: 'publier_tableau', input: PUBLISHED }],
        [{ type: 'tool_use', id: 'r3', name: 'publier_tableau', input: PUBLISHED }],
      ],
    });
    const c = await signedIn(env);
    await c.call('PUT', '/api/settings', { mcp_url: MCP_URL, mcp_key: 'cle-secrete' });
    const first = await collectOverview(c);
    expect(first.json.overview.series.ca_mensuel).toHaveLength(2);
    expect(env.scripted.calls).toBe(2);
    const row = (await env.db.query<{ overview_recipe: unknown }>('SELECT overview_recipe FROM settings'))[0]!;
    expect(row.overview_recipe).toEqual([{ tool: 'list_quotes', args: { status: 'sent' } }]);
    // Deuxième collecte : l'appel part AVANT Claude, qui publie au premier passage.
    await collectOverview(c);
    expect(env.scripted.calls).toBe(3);
    expect(env.interfast.calls.map((x) => x.name)).toEqual(['list_quotes', 'list_quotes']);
    const intro = JSON.stringify(env.scripted.requests[2]!.messages[0]);
    expect(intro).toContain('if_list_quotes');
    expect(intro).toContain('D-2026-0012');
    // Le tableau de bord passe par le modèle rapide.
    expect(env.scripted.requests[2]!.model).toBe('claude-sonnet-5-5');
    // Changer de serveur Interfast oublie la recette.
    await c.call('PUT', '/api/settings', { mcp_url: 'https://autre.interfast.test/mcp' });
    expect((await env.db.query<{ overview_recipe: unknown }>('SELECT overview_recipe FROM settings'))[0]!.overview_recipe).toBeNull();
  });

  it('progression : appels Interfast un par un, calcul, durée mémorisée pour estimer la suivante', async () => {
    const env = await setup({
      script: [
        [{ type: 'tool_use', id: 'g1', name: 'if_list_quotes', input: {} }],
        [{ type: 'tool_use', id: 'g2', name: 'publier_tableau', input: PUBLISHED }],
        [{ type: 'tool_use', id: 'g3', name: 'publier_tableau', input: PUBLISHED }],
      ],
    });
    const c = await signedIn(env);
    await c.call('PUT', '/api/settings', { mcp_url: MCP_URL, mcp_key: 'cle-secrete' });
    // POST répond tout de suite (202), sans attendre la fin.
    const start = await c.call('POST', '/api/interfast/overview');
    expect(start.status).toBe(202);
    expect(start.json.job).toMatchObject({ state: 'en_cours', estimateMs: null });
    const done = await collectOverview(c);
    expect(done.json.job.state).toBe('fini');
    expect(done.json.job.calls).toEqual([expect.objectContaining({ label: 'list_quotes', state: 'ok' })]);
    expect(done.json.overview.resume).toBe('Un devis à relancer.');
    // Durée gardée : la lecture suivante a une estimation, l'état de la connexion la montre.
    const st = await c.call('GET', '/api/interfast/status');
    expect(st.json.lastRead).toMatchObject({ calls: 1 });
    const again = await c.call('POST', '/api/interfast/overview');
    expect(typeof again.json.job.estimateMs).toBe('number');
    await collectOverview(c);
    // Claude Sonnet 5.5 : sans réflexion longue.
    expect(env.scripted.requests.at(-1)!.thinking).toEqual({ type: 'between_tools' });
  });

  it('un autre compte ne voit pas le tableau', async () => {
    const env = await setup({ script: [[{ type: 'tool_use', id: 'o2', name: 'publier_tableau', input: PUBLISHED }]] });
    const a = await signedIn(env, 'a@example.fr');
    await a.call('PUT', '/api/settings', { mcp_url: MCP_URL, mcp_key: 'cle-secrete' });
    await collectOverview(a);
    const b = await signedIn(env, 'b@example.fr');
    expect((await b.call('GET', '/api/interfast/overview')).json.overview).toBeNull();
  });

  it('sans Interfast : refus clair ; un outil inventé par le modèle échoue proprement', async () => {
    const env = await setup({
      script: [
        [{ type: 'tool_use', id: 'x1', name: 'if_create_quote', input: {} }],
        [{ type: 'tool_use', id: 'x2', name: 'publier_tableau', input: PUBLISHED }],
      ],
    });
    const c = await signedIn(env);
    expect((await collectOverview(c)).status).toBe(400);
    await c.call('PUT', '/api/settings', { mcp_url: MCP_URL, mcp_key: 'cle-secrete' });
    await collectOverview(c);
    // L'outil d'écriture demandé n'existe pas pour la collecte : jamais exécuté.
    expect(env.interfast.calls).toEqual([]);
    expect(JSON.stringify(env.scripted.requests[1]!.messages.at(-1))).toContain('Outil indisponible');
  });

  it('état de la connexion : outils, délai, activité de la semaine', async () => {
    const env = await setup();
    const c = await signedIn(env);
    expect((await c.call('GET', '/api/interfast/status')).json).toMatchObject({ configured: false, ok: false });
    await c.call('PUT', '/api/settings', { mcp_url: MCP_URL, mcp_key: 'cle-secrete' });
    const r = await c.call('GET', '/api/interfast/status');
    expect(r.json).toMatchObject({ configured: true, ok: true, host: 'mcp.interfast.test', keyHint: '••••rete' });
    expect(r.json.tools).toHaveLength(3);
    expect(typeof r.json.latencyMs).toBe('number');
    await c.call('PUT', '/api/settings', { mcp_key: 'fausse' });
    const bad = await c.call('GET', '/api/interfast/status');
    expect(bad.json.ok).toBe(false);
    expect(bad.json.error).toMatch(/refuse la clé/);
  });

  it('sanitize : borne, nettoie, n’accepte que des nombres finis', () => {
    const o = sanitize({ kpis: [{ libelle: 'X', valeur: 'beaucoup', unite: 'kg' }], devis_a_relancer: Array(30).fill({ ref: 'r', client: 'c', montant_ht: Infinity }) }, ['a', 'a']);
    expect(o.kpis[0]).toMatchObject({ valeur: null, unite: 'nombre' });
    expect(o.devis_a_relancer).toHaveLength(10);
    expect(o.devis_a_relancer[0]!.montant_ht).toBeNull();
    expect(o.sources).toEqual(['a']);
    expect(o.factures_impayees).toEqual([]);
  });
});
