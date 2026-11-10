/**
 * Le texte de la voix, PUR et sans navigateur : partagé par l'appli (lecture à
 * voix haute, réponses dites) et par le serveur (réponses lues par Siri, route
 * /api/voix). Une seule règle pour les deux : « je valide » valide, un « oui »
 * seul ne valide jamais ; les euros se disent « euros hors taxes ».
 */

/** Texte lisible à voix haute : sans markdown ni symboles. PUR, testé. */
export function speakable(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, '')
    .replace(/^\s*\|.*\|\s*$/gm, '')
    .replace(/[*_`#>]/g, '')
    .replace(/^\s*[-•]\s+(.*?)\s*$/gm, (_, item: string) => (/[.!?:;]$/.test(item) ? item : `${item}.`))
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/€\s?HT\b/g, 'euros hors taxes')
    .replace(/€\s?TTC\b/g, 'euros TTC')
    .replace(/€/g, 'euros')
    .replace(/\bHT\b/g, 'hors taxes')
    .replace(/(\d)\s?%/g, '$1 pour cent')
    .replace(/\s+→\s+/g, ', ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/**
 * Ce qu'une phrase dite décide face à une action en attente de validation.
 * Seules des formules EXPLICITES valident ; un « oui » seul ne suffit pas (la
 * reconnaissance confond facilement). PUR, testé.
 */
export function voiceDecision(t: string): 'valider' | 'refuser' | null {
  const s = t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z' ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (/^(je valide|valider|valide|oui je valide|c'est valide|je confirme|confirmer)( le devis| la creation)?( merci)?$/.test(s)) return 'valider';
  if (/^(non|refuser|je refuse|refuse|annuler|annule|stop|ne fais rien)( merci)?$/.test(s)) return 'refuser';
  return null;
}

/** L'option d'une question à choix que désigne une phrase dite, s'il y en a une seule. PUR, testé. */
export function matchOption(t: string, options: string[]): string | null {
  const norm = (x: string) => x.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const s = norm(t);
  const exact = options.filter((o) => norm(o) === s);
  if (exact.length === 1) return exact[0]!;
  const inside = options.filter((o) => norm(o).length >= 2 && (` ${s} `).includes(` ${norm(o)} `));
  return inside.length === 1 ? inside[0]! : null;
}
