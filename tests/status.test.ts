/** Couleurs des statuts : une par famille, jamais partagée, ordre fixe. */
import { describe, expect, it } from 'vitest';
import { groupPipeline, statusFamily } from '../src/lib/status';

describe('statuts de devis', () => {
  it('reconnaît les familles', () => {
    expect(statusFamily('Envoyé').key).toBe('envoye');
    expect(statusFamily('payé').key).toBe('paye');
    expect(statusFamily('Facturé').key).toBe('paye');
    expect(statusFamily('Signé').key).toBe('signe');
    expect(statusFamily('accepté').key).toBe('signe');
    expect(statusFamily('Expiré').key).toBe('refuse');
    expect(statusFamily('brouillon').key).toBe('brouillon');
    expect(statusFamily('En révision').key).toBe('autres');
  });

  it('une couleur par part, ordre de vie du devis, familles additionnées', () => {
    const parts = groupPipeline([
      { statut: 'Payé', nombre: 9, montant_ht: 21357 },
      { statut: 'Envoyé', nombre: 19, montant_ht: 72671 },
      { statut: 'Brouillon', nombre: 4, montant_ht: 19354 },
      { statut: 'Signé', nombre: 2, montant_ht: 23234 },
      { statut: 'Accepté', nombre: 1, montant_ht: 1000 },
      { statut: 'Zarbi', nombre: 1, montant_ht: 50 },
      { statut: 'Refusé', nombre: 0, montant_ht: 0 },
    ]);
    expect(parts.map((p) => p.label)).toEqual(['Brouillon', 'Envoyé', 'Signé', 'Payé', 'Autres']);
    expect(new Set(parts.map((p) => p.slot)).size).toBe(parts.length);
    expect(parts[2]).toMatchObject({ nombre: 3, montant_ht: 24234, sources: ['Signé', 'Accepté'] });
  });
});
