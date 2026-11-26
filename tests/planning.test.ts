import { describe, expect, it } from 'vitest';
import { addDays, mondayOf, weekLabel } from '../src/lib/planning';
import { periodRate, splitMargin } from '../src/lib/margin';

describe('semaine du planning', () => {
  it('lundi, ajout de jours, libellé', () => {
    expect(mondayOf('2026-11-26')).toBe('2026-11-23');
    expect(addDays('2026-11-30', 7)).toBe('2026-12-07');
    expect(weekLabel('2026-11-23')).toBe('Semaine du 23 au 29 nov. 2026');
    expect(weekLabel('2026-11-30')).toBe('Semaine du 30 nov. au 6 déc. 2026');
  });
});

describe('marge sur le CA', () => {
  it('coupe le CA en marge + coûts, garde gris un mois sans coûts', () => {
    expect(splitMargin({ mois: '2026-10', montant_ht: 10000, marge_ht: 3500 })).toEqual({ marge: 3500, couts: 6500, inconnu: null, taux: 35 });
    expect(splitMargin({ mois: '2026-10', montant_ht: 10000 })).toMatchObject({ marge: null, inconnu: 10000 });
    expect(splitMargin({ mois: '2026-10', montant_ht: null, marge_ht: 100 })).toMatchObject({ marge: null, inconnu: null });
  });
  it('taux de la période sur les seuls mois complets', () => {
    expect(periodRate([{ mois: 'a', montant_ht: 1000, marge_ht: 400 }, { mois: 'b', montant_ht: 3000, marge_ht: 600 }, { mois: 'c', montant_ht: 5000, marge_ht: null }])).toBe(25);
    expect(periodRate([{ mois: 'a', montant_ht: 1000 }])).toBeNull();
  });
});
