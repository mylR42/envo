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
    expect(speakable('**Total** : 690 € HT\n- ligne 1\n| a | b |')).toBe('Total : 690 euros hors taxes\nligne 1');
  });
});
