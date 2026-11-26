import { describe, expect, it } from 'vitest';
import { bodyText, gmailQuery, htmlToText, MAIL_TEXT_MAX, recipients, stripQuoted } from '../server/gmail';

describe('Gmail : outils purs', () => {
  it('requête Gmail', () => {
    expect(gmailQuery({})).toBe('in:inbox');
    expect(gmailQuery({ non_lus: true })).toBe('is:unread in:inbox');
    expect(gmailQuery({ requete: 'from:leroy devis', depuis_jours: 7 })).toBe('from:leroy devis newer_than:7d');
    expect(gmailQuery({ requete: 'a"b\\c\nd' })).toBe('a b c d');
  });
  it('HTML → texte, sans script', () => {
    expect(htmlToText('<style>p{}</style><p>Bonjour&nbsp;Paul</p><script>alert(1)</script><div>À&amp;B</div>')).toBe('Bonjour Paul\nÀ&B');
  });
  it('coupe l’historique cité', () => {
    expect(stripQuoted('Oui, jeudi.\n\nLe 25 nov. 2026, Paul a écrit :\n> Vous passez ?')).toBe('Oui, jeudi.');
    expect(bodyText({ text: 'x'.repeat(MAIL_TEXT_MAX + 10), html: false })).toHaveLength(MAIL_TEXT_MAX);
    expect(bodyText({ text: '', html: '<p>Salut</p>' })).toBe('Salut');
  });
  it('destinataires : valides, dix au plus', () => {
    expect(recipients('a@b.fr, Jean Dupont <j@d.fr>')).toEqual(['a@b.fr', 'Jean Dupont <j@d.fr>']);
    expect(recipients('')).toEqual([]);
    expect(() => recipients('pas une adresse')).toThrow(/invalide/);
    expect(() => recipients(Array.from({ length: 11 }, (_, i) => `a${i}@b.fr`).join(','))).toThrow(/Dix/);
  });
});
