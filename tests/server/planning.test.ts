/**
 * Planning Interfast (lecture seule, en mémoire, recette aux dates de la
 * période) et import d'un planning fournisseur en PDF (proposition, puis
 * écriture des SEULES lignes cochées, aux arguments gardés en base).
 */
import { describe, expect, it } from 'vitest';
import { fillArgs, mondayOf, sanitizePlanning, templateArgs } from '../../server/planning';
import { describeWriteTools, sanitizeProposal } from '../../server/planimport';
import { sanitize } from '../../server/overview';
import type { McpTool } from '../../server/mcp';
import { client, MCP_URL, setup, signedIn } from './helpers';

const PDF = Buffer.from('%PDF-1.4\n% planning fournisseur\n').toString('base64');

async function follow(c: ReturnType<typeof client>, path: string, done: (j: Record<string, any>) => boolean) {
  for (let i = 0; i < 200; i++) {
    const r = await c.call('GET', path);
    if (done(r.json)) return r;
    await new Promise((ok) => setTimeout(ok, 10));
  }
  throw new Error('sans fin');
}

const PLAN = {
  evenements: [
    { ref: 'I-1', date: '2026-11-10', debut: '8h30', fin: '12:00', type: 'intervention', objet: 'Pose chaudière', client: 'Martin Dupont', lieu: 'Angers', intervenants: ['Julien'], statut: 'planifié' },
    { ref: 'I-2', date: '2026-12-25', debut: '', fin: '', type: 'chantier', objet: 'Hors période', client: 'X', lieu: '', intervenants: [], statut: '' },
    { ref: 'I-3', date: '2026-11-09', debut: '07:00', fin: '', type: 'inconnu', objet: 'Livraison', client: '', lieu: '', intervenants: ['Paul'], statut: '' },
  ],
  intervenants: ['Julien'],
  manques: [],
  resume: 'Semaine chargée.',
};

describe('planning : nettoyage (pur)', () => {
  it('garde la période, normalise les heures, complète l’équipe', () => {
    const p = sanitizePlanning(PLAN, ['list_quotes'], '2026-11-09', '2026-11-15');
    expect(p.evenements.map((e) => e.ref)).toEqual(['I-3', 'I-1']);
    expect(p.evenements[1]).toMatchObject({ debut: '08:30', fin: '12:00' });
    expect(p.evenements[0]!.type).toBe('autre');
    expect(p.intervenants).toEqual(['Julien', 'Paul']);
  });
  it('lundi de la semaine, recette aux repères de dates', () => {
    expect(mondayOf('2026-11-26')).toBe('2026-11-23');
    expect(mondayOf('2026-11-23')).toBe('2026-11-23');
    expect(mondayOf('2026-11-29')).toBe('2026-11-23');
    const t = templateArgs({ from: '2026-11-23', to: '2026-11-29T23:59:00', n: 3, l: ['2026-11-23'] }, '2026-11-23', '2026-11-29');
    expect(t).toEqual({ from: '{{debut}}', to: '{{fin}}T23:59:00', n: 3, l: ['{{debut}}'] });
    expect(fillArgs(t, '2026-11-30', '2026-12-06')).toEqual({ from: '2026-11-30', to: '2026-12-06T23:59:00', n: 3, l: ['2026-11-30'] });
  });
});

describe('marge sur le CA (pur)', () => {
  it('une marge plus grande que le CA, ou sans CA, est écartée', () => {
    const o = sanitize({ series: { ca_mensuel: [
      { mois: '2026-10', montant_ht: 9000, marge_ht: 3000 },
      { mois: '2026-11', montant_ht: 1000, marge_ht: 5000 },
      { mois: '2026-09', montant_ht: null, marge_ht: 200 },
    ] } }, []);
    expect(o.series.ca_mensuel.map((m) => m.marge_ht)).toEqual([3000, null, null]);
  });
});

describe('planning Interfast (API)', () => {
  it('lit en lecture seule, garde en mémoire par semaine, rejoue la recette aux nouvelles dates', async () => {
    const env = await setup({
      script: [
        [{ type: 'tool_use', id: 'p1', name: 'if_list_quotes', input: { from: '2026-11-02', to: '2026-11-08' } }],
        [{ type: 'tool_use', id: 'p2', name: 'publier_planning', input: { ...PLAN, evenements: [{ ...PLAN.evenements[0], date: '2026-11-03' }] } }],
        [{ type: 'tool_use', id: 'p3', name: 'publier_planning', input: PLAN }],
      ],
    });
    const c = await signedIn(env);
    await c.call('PUT', '/api/settings', { mcp_url: MCP_URL, mcp_key: 'cle-secrete' });
    const empty = await c.call('GET', '/api/planning?du=2026-11-04');
    expect(empty.json).toMatchObject({ du: '2026-11-02', au: '2026-11-08', planning: null, configured: true });

    expect((await c.call('POST', '/api/planning', { du: '2026-11-04' })).status).toBe(202);
    const r = await follow(c, '/api/planning?du=2026-11-02', (j) => j.job?.state !== 'en_cours');
    expect(r.json.planning.evenements).toHaveLength(1);
    expect(r.json.planning.evenements[0]).toMatchObject({ objet: 'Pose chaudière', debut: '08:30' });
    // ⚠️ Aucun outil d'écriture proposé au modèle.
    expect(env.scripted.requests[0]!.tools!.map((t) => (t as { name: string }).name)).toEqual(['if_list_quotes', 'if_search_customers', 'publier_planning']);
    const row = (await env.db.query<{ planning_recipe: unknown }>('SELECT planning_recipe FROM settings'))[0]!;
    expect(row.planning_recipe).toEqual([{ tool: 'list_quotes', args: { from: '{{debut}}', to: '{{fin}}' } }]);

    // Semaine suivante : la recette part avant Claude, aux dates de CETTE semaine.
    await c.call('POST', '/api/planning', { du: '2026-11-09' });
    const r2 = await follow(c, '/api/planning?du=2026-11-09', (j) => j.job?.state !== 'en_cours');
    expect(env.interfast.calls.at(-1)).toMatchObject({ name: 'list_quotes', args: { from: '2026-11-09', to: '2026-11-15' } });
    expect(r2.json.planning.evenements.map((e: { ref: string }) => e.ref)).toEqual(['I-3', 'I-1']);
    expect(env.scripted.calls).toBe(3);
    // Rien en base.
    expect(JSON.stringify(await env.db.query('SELECT * FROM settings'))).not.toContain('Pose chaudière');
  });
});

describe('import d’un planning fournisseur', () => {
  const tools: McpTool[] = [
    { name: 'list_quotes', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } },
    { name: 'create_quote', inputSchema: { type: 'object', properties: { customer_id: { type: 'string' } } } },
  ];

  it('nettoyage : seul un outil d’écriture connu rend une ligne importable', () => {
    const p = sanitizeProposal(
      {
        fournisseur: 'Cedeo',
        lignes: [
          { date: '2026-12-01', debut: '08:00', objet: 'Livraison', outil: 'if_create_quote', arguments: { customer_id: 'c-42' } },
          { date: '2026-12-02', objet: 'Lecture', outil: 'if_list_quotes', arguments: { a: 1 } },
          { date: '2026-12-03', objet: 'Inventé', outil: 'if_delete_everything', arguments: {} },
        ],
      },
      tools,
    );
    expect(p.lignes.map((l) => l.importable)).toEqual([true, false, false]);
    expect(p.lignes[0]!.outil).toBe('create_quote');
    expect(p.lignes[1]!.arguments).toEqual({});
    expect(describeWriteTools(tools)).toContain('if_create_quote');
    expect(describeWriteTools(tools)).not.toContain('if_list_quotes');
  });

  it('PDF → proposition (rien n’est écrit) → seules les lignes cochées partent, une seule fois', async () => {
    const env = await setup({
      script: [
        [{ type: 'tool_use', id: 'i1', name: 'if_list_quotes', input: {} }],
        [
          {
            type: 'tool_use',
            id: 'i2',
            name: 'proposer_import',
            input: {
              fournisseur: 'Cedeo',
              resume: 'Deux livraisons.',
              lignes: [
                { date: '2026-12-01', debut: '08:00', fin: '09:00', objet: 'Livraison chaudière', chantier: 'Martin Dupont', intervenant: 'Julien', remarque: '', outil: 'if_create_quote', arguments: { customer_id: 'c-42', lines: [] }, doublon: false },
                { date: '2026-12-02', debut: '', fin: '', objet: 'Livraison radiateurs', chantier: 'Martin Dupont', intervenant: '', remarque: '', outil: 'if_create_quote', arguments: { customer_id: 'c-43' }, doublon: true },
              ],
              ignores: ['Retours de palettes : hors consignes.'],
              manques: [],
            },
          },
        ],
      ],
    });
    const c = await signedIn(env);
    await c.call('PUT', '/api/settings', { mcp_url: MCP_URL, mcp_key: 'cle-secrete' });

    expect((await c.call('POST', '/api/planning/imports', { nom: 'cedeo.pdf', pdf: Buffer.from('pas un pdf').toString('base64') })).status).toBe(400);
    const start = await c.call('POST', '/api/planning/imports', { nom: 'cedeo.pdf', pdf: `data:application/pdf;base64,${PDF}`, consignes: 'Seulement les livraisons.' });
    expect(start.status).toBe(202);
    const id = start.json.id as string;
    const r = await follow(c, `/api/planning/imports/${id}`, (j) => j.import?.state !== 'preparation');
    expect(r.json.import.state).toBe('proposee');
    expect(r.json.import.proposal.lignes.map((l: { importable: boolean; doublon: boolean }) => [l.importable, l.doublon])).toEqual([
      [true, false],
      [true, true],
    ]);
    // Le PDF et les consignes sont partis à Claude ; les outils d'écriture ne lui sont que DÉCRITS.
    const req = env.scripted.requests[0]!;
    const first = req.messages[0]!.content as { type: string; source?: { media_type: string } }[];
    expect(first[0]).toMatchObject({ type: 'document', source: { media_type: 'application/pdf' } });
    expect(JSON.stringify(first[1])).toContain('Seulement les livraisons.');
    expect(req.tools!.map((t) => (t as { name: string }).name)).toEqual(['if_list_quotes', 'if_search_customers', 'proposer_import']);
    expect(JSON.stringify(req.system)).toContain('if_create_quote');
    // Rien d'écrit à ce stade, et le PDF n'est pas gardé.
    expect(env.interfast.calls.map((x) => x.name)).toEqual(['list_quotes']);
    expect(JSON.stringify(await env.db.query('SELECT * FROM imports'))).not.toContain(PDF.slice(0, 20));

    // Une ligne cochée (la 0), un indice hors liste ignoré : un seul appel, aux arguments gardés.
    expect((await c.call('POST', `/api/planning/imports/${id}/valider`, { lignes: [] })).status).toBe(400);
    expect((await c.call('POST', `/api/planning/imports/${id}/valider`, { lignes: [0, 7] })).status).toBe(202);
    const done = await follow(c, `/api/planning/imports/${id}`, (j) => j.import?.state !== 'import_en_cours');
    expect(done.json.import.state).toBe('importee');
    expect(env.interfast.calls.filter((x) => x.name === 'create_quote').map((x) => x.args)).toEqual([{ customer_id: 'c-42', lines: [] }]);
    expect((await c.call('POST', `/api/planning/imports/${id}/valider`, { lignes: [1] })).status).toBe(409);
    expect(env.interfast.calls.filter((x) => x.name === 'create_quote')).toHaveLength(1);

    // Un autre compte ne voit rien.
    const other = await signedIn(env, 'autre@example.fr');
    expect((await other.call('GET', `/api/planning/imports/${id}`)).status).toBe(404);
    expect((await other.call('POST', `/api/planning/imports/${id}/valider`, { lignes: [1] })).status).toBe(404);
    expect((await c.call('GET', '/api/planning/imports')).json.imports[0]).toMatchObject({ file_name: 'cedeo.pdf', state: 'importee', lignes: 2 });
  });
});
