/** Client MCP et règles pures : lecture du flux SSE, lecture/écriture, URL. */
import { describe, expect, it } from 'vitest';
import { isWriteTool, MAX_RESULT_CHARS, parseSse, resultText } from '../../server/mcp';
import { validMcpUrl } from '../../server/app';
import { createsQuote } from '../../server/agent';
import { sessionContext } from '../../server/prompt';

describe('MCP', () => {
  it('lit un flux SSE de plusieurs événements, lignes data multiples comprises', () => {
    const body = 'event: ping\ndata: pas du json\n\nevent: message\ndata: {"jsonrpc":"2.0",\ndata: "id":3,"result":{}}\n\n';
    expect(parseSse(body)).toEqual([{ jsonrpc: '2.0', id: 3, result: {} }]);
  });

  it('texte d’un résultat : blocs texte, contenu structuré, troncature dite', () => {
    expect(resultText({ content: [{ type: 'text', text: 'a' }, { type: 'image' }] }).text).toBe('a\n[contenu image non affiché]');
    expect(resultText({ structuredContent: { id: 1 } }).text).toBe('{"id":1}');
    expect(resultText({ content: [{ type: 'text', text: 'x' }], isError: true }).isError).toBe(true);
    const long = resultText({ content: [{ type: 'text', text: 'x'.repeat(MAX_RESULT_CHARS + 10) }] }).text;
    expect(long).toMatch(/tronquée/);
  });

  it('écriture ou lecture : l’annotation fait foi, sinon le nom, et dans le doute écriture', () => {
    expect(isWriteTool({ name: 'create_quote' })).toBe(true);
    expect(isWriteTool({ name: 'creer_devis' })).toBe(true);
    expect(isWriteTool({ name: 'send_quote_by_email' })).toBe(true);
    expect(isWriteTool({ name: 'list_quotes' })).toBe(false);
    expect(isWriteTool({ name: 'get_customer' })).toBe(false);
    expect(isWriteTool({ name: 'rechercher_clients' })).toBe(false);
    expect(isWriteTool({ name: 'quote_magic' })).toBe(true);
    expect(isWriteTool({ name: 'quote_magic', annotations: { readOnlyHint: true } })).toBe(false);
    expect(isWriteTool({ name: 'list_and_delete', annotations: { readOnlyHint: false } })).toBe(true);
  });

  it('reconnaît la création d’un devis', () => {
    expect(createsQuote('create_quote')).toBe(true);
    expect(createsQuote('creer_devis')).toBe(true);
    expect(createsQuote('update_quote')).toBe(false);
    expect(createsQuote('create_invoice')).toBe(false);
  });

  it('URL du serveur MCP : https public seulement', () => {
    expect(validMcpUrl('https://mcp.inter-fast.fr/v1/xyz')).toBe('https://mcp.inter-fast.fr/v1/xyz');
    for (const u of ['http://a.fr', 'https://10.0.0.1', 'https://172.20.1.1', 'https://169.254.169.254/latest', 'https://srv.internal', 'ftp://a.fr', 'pas une url'])
      expect(validMcpUrl(u), u).toBeNull();
  });

  it('contexte de séance : réglages, REX, avis séparés, valeurs absentes dites', () => {
    const ctx = sessionContext({
      name: 'Paul',
      now: new Date('2026-11-07T09:00:00Z'),
      settings: { company: 'Dupont', trade: 'plombier', hourly_rate: 50, vat_rate: null, margin_pct: 20, travel_fee: null, validity_days: 30, notes: '' },
      rex: [
        { kind: 'tarif', content: 'Main d’œuvre à 50 €', created_at: '2026-10-01' },
        { kind: 'avis', content: 'Plus court', created_at: '2026-10-02' },
      ],
      past: [],
    });
    expect(ctx).toContain('taux horaire 50 € HT');
    expect(ctx).toContain('TVA par défaut non renseigné');
    expect(ctx).toContain('[tarif, 2026-10-01] Main d’œuvre à 50 €');
    expect(ctx).toMatch(/retours[\s\S]*Plus court/);
    expect(ctx).toContain('2026-11-07');
  });
});
