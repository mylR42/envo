/**
 * Tableau de bord Interfast : collecte en LECTURE SEULE, résultat en mémoire,
 * rien d'inventé, état de la connexion.
 */
import { describe, expect, it } from 'vitest';
import { sanitize } from '../../server/overview';
import { MCP_URL, setup, signedIn } from './helpers';

const PUBLISHED = {
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

    const r = await c.call('POST', '/api/interfast/overview');
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
    // Expiré au bout de 30 minutes.
    env.clock.t = new Date(env.clock.t.getTime() + 31 * 60_000);
    expect((await c.call('GET', '/api/interfast/overview')).json.overview).toBeNull();
  });

  it('un autre compte ne voit pas le tableau', async () => {
    const env = await setup({ script: [[{ type: 'tool_use', id: 'o2', name: 'publier_tableau', input: PUBLISHED }]] });
    const a = await signedIn(env, 'a@example.fr');
    await a.call('PUT', '/api/settings', { mcp_url: MCP_URL, mcp_key: 'cle-secrete' });
    await a.call('POST', '/api/interfast/overview');
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
    expect((await c.call('POST', '/api/interfast/overview')).status).toBe(400);
    await c.call('PUT', '/api/settings', { mcp_url: MCP_URL, mcp_key: 'cle-secrete' });
    await c.call('POST', '/api/interfast/overview');
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
