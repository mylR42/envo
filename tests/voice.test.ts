/** La voix : ce qui se lit, et surtout ce qu'une phrase dite a le droit de décider. */
import { describe, expect, it } from 'vitest';
import { matchOption, speakable, voiceDecision } from '../src/lib/voice';

describe('voix', () => {
  it('une validation exige une formule explicite', () => {
    expect(voiceDecision('Je valide')).toBe('valider');
    expect(voiceDecision('je valide le devis')).toBe('valider');
    expect(voiceDecision('Validé !')).toBe('valider');
    // « oui » seul, ou une phrase qui CONTIENT « valide », ne valide rien.
    expect(voiceDecision('oui')).toBeNull();
    expect(voiceDecision('ok')).toBeNull();
    expect(voiceDecision('je valide pas du tout ce prix')).toBeNull();
    expect(voiceDecision('non')).toBe('refuser');
    expect(voiceDecision('Annule')).toBe('refuser');
  });

  it('reconnaît une option dite, sans ambiguïté', () => {
    const o = ['150 L', '200 L', '300 L'];
    expect(matchOption('200 L', o)).toBe('200 L');
    expect(matchOption('plutôt le 200 l', o)).toBe('200 L');
    expect(matchOption('je ne sais pas', o)).toBeNull();
    expect(matchOption('Électrique', ['Electrique', 'Gaz'])).toBe('Electrique');
    // Deux options présentes : on n'en choisit pas une au hasard.
    expect(matchOption('gaz ou électrique', ['Electrique', 'Gaz'])).toBeNull();
  });

  it('texte lisible : sans markdown, euros dits en toutes lettres', () => {
    expect(speakable('**Total** : 690 € HT\n- ligne 1\n| a | b |')).toBe('Total : 690 euros hors taxes\nligne 1.');
  });
});

describe('lecture à voix haute', async () => {
  const { chunks, speakable } = await import('../src/lib/voice');
  it('listes et abréviations lues correctement', () => {
    expect(speakable('**En attente** : 19 devis, 72 700 € HT\n- D0003, Mme Croppi : 4 320 € HT\n- Taux 46 %')).toBe(
      'En attente : 19 devis, 72 700 euros hors taxes\nD0003, Mme Croppi : 4 320 euros hors taxes.\nTaux 46 pour cent.',
    );
  });
  it('découpe en morceaux courts, aux fins de phrase, sans rien perdre', () => {
    const t = 'Voici le point. '.repeat(30) + 'Fin.';
    const c = chunks(t);
    expect(c.every((x) => x.length <= 220)).toBe(true);
    expect(c.join(' ').replace(/\s+/g, ' ')).toBe(t.trim().replace(/\s+/g, ' '));
    expect(chunks('a'.repeat(500)).every((x) => x.length <= 220)).toBe(true);
    expect(chunks('Une ligne.\nUne autre.')).toEqual(['Une ligne.', 'Une autre.']);
  });
});
