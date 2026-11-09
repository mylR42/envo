/** Totaux du brouillon : HT, TVA ventilée par taux, TTC, arrondis au centime. */
import { describe, expect, it } from 'vitest';
import { totals } from '../src/lib/format';

describe('totaux du brouillon', () => {
  it('ventile la TVA par taux', () => {
    const t = totals([
      { designation: 'Chauffe-eau', quantite: 1, prix_unitaire_ht: 690, tva: 10 },
      { designation: 'Main d’œuvre', quantite: 3.5, prix_unitaire_ht: 48, tva: 10 },
      { designation: 'Robinet design', quantite: 1, prix_unitaire_ht: 120.333, tva: 20 },
    ]);
    expect(t.ht).toBe(978.33);
    expect(t.byRate).toEqual([
      { rate: 10, base: 858, tva: 85.8 },
      { rate: 20, base: 120.33, tva: 24.07 },
    ]);
    expect(t.tva).toBe(109.87);
    expect(t.ttc).toBe(1088.2);
  });

  it('une ligne illisible ne fausse pas le total', () => {
    expect(totals([{ designation: 'x', quantite: Number('a'), prix_unitaire_ht: 10 }, { designation: 'y', quantite: 2, prix_unitaire_ht: 5 }]).ht).toBe(10);
  });

  it('taux absent : taux par défaut, sinon 0', () => {
    expect(totals([{ designation: 'y', quantite: 1, prix_unitaire_ht: 100 }], 20).ttc).toBe(120);
    expect(totals([{ designation: 'y', quantite: 1, prix_unitaire_ht: 100 }]).ttc).toBe(100);
  });
});

describe('libellés Interfast en français', async () => {
  const { fieldLabel, toolLabel } = await import('../src/lib/format');
  it('champs', () => {
    expect(fieldLabel('unit_price')).toBe('PU HT');
    expect(fieldLabel('customer_id')).toBe('Client');
    expect(fieldLabel('lines')).toBe('Lignes');
    expect(fieldLabel('quoteNumber')).toBe('Devis number');
  });
  it('outils', () => {
    expect(toolLabel('create_quote')).toBe('Créer devis');
    expect(toolLabel('search_customers')).toBe('Chercher clients');
    expect(toolLabel('send_quote_by_email')).toBe('Envoyer devis par e-mail');
    expect(toolLabel('weird_tool')).toBe('Weird tool');
  });
});
