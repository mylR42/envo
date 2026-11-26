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

import { conflicts, load, upcoming, visibleDays, whenLabel } from '../src/lib/planning';

const ev = (date: string, debut: string, fin: string, qui: string[], objet = 'x') => ({ date, debut, fin, objet, client: '', intervenants: qui });

describe('lire la semaine', () => {
  it('jours affichés : sans dimanche par défaut, mais un dimanche occupé reste visible', () => {
    expect(visibleDays('2026-11-23', 6, [])).toHaveLength(6);
    expect(visibleDays('2026-11-23', 5, []).at(-1)).toBe('2026-11-27');
    expect(visibleDays('2026-11-23', 5, [ev('2026-11-29', '', '', [])])).toEqual(['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-29']);
  });
  it('conflit : même personne, heures qui se chevauchent', () => {
    const c = conflicts([ev('2026-11-25', '08:00', '17:00', ['Benjamin']), ev('2026-11-25', '11:30', '12:30', ['Benjamin']), ev('2026-11-25', '11:00', '12:00', ['Paul']), ev('2026-11-25', '', '', ['Benjamin'])]);
    expect(c).toHaveLength(1);
    expect(c[0]!.qui).toBe('Benjamin');
  });
  it('à venir : à partir de maintenant, dans l’ordre', () => {
    const list = [ev('2026-11-27', '09:00', '', []), ev('2026-11-26', '08:00', '09:00', [], 'passé'), ev('2026-11-26', '14:00', '15:00', [], 'cet après-midi')];
    expect(upcoming(list, '2026-11-26', '11:00').map((e) => e.objet)).toEqual(['cet après-midi', 'x']);
    expect(whenLabel('2026-11-27', '2026-11-26')).toBe('Demain');
    expect(load([ev('d', '', '', ['B']), ev('d', '', '', ['B', 'P']), ev('d', '', '', [])])).toEqual([{ qui: 'B', n: 2 }, { qui: 'Non affecté', n: 1 }, { qui: 'P', n: 1 }]);
  });
});
