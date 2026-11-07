/**
 * La voix, sans serveur ni service tiers : reconnaissance (Web Speech API,
 * `SpeechRecognition` / `webkitSpeechRecognition`) et lecture à voix haute
 * (`speechSynthesis`), en français.
 *
 * - Safari (iPhone) et Chrome la proposent ; Firefox non : le micro disparaît
 *   alors de l'écran au lieu d'être un bouton qui ne fait rien.
 * - Sur iPhone, la reconnaissance ne démarre que PENDANT un appui.
 * - ⚠️ Une validation d'écriture dans Interfast n'est JAMAIS déduite d'un « oui »
 *   approximatif : seules des formules explicites valident (`voiceDecision`).
 */

type Rec = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

const Ctor = (): (new () => Rec) | null => {
  const w = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

export const canListen = () => typeof window !== 'undefined' && Ctor() !== null;
export const canSpeak = () => typeof window !== 'undefined' && 'speechSynthesis' in window;

export interface Listening {
  stop(): void;
}

/** Écoute une phrase : `onInterim` pendant qu'on parle, `onFinal` à la fin. */
export function listen(h: { onInterim(t: string): void; onFinal(t: string): void; onEnd(): void; onError(msg: string): void }): Listening | null {
  const C = Ctor();
  if (!C) return null;
  const r = new C();
  r.lang = 'fr-FR';
  r.continuous = false;
  r.interimResults = true;
  let finalText = '';
  r.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i]!;
      if (res.isFinal) finalText += res[0].transcript;
      else interim += res[0].transcript;
    }
    h.onInterim((finalText + interim).trim());
  };
  r.onerror = (e) => {
    if (e.error === 'no-speech' || e.error === 'aborted') return;
    h.onError(e.error === 'not-allowed' ? 'Micro refusé : autorisez-le dans les réglages du navigateur.' : `Micro : ${e.error}`);
  };
  r.onend = () => {
    if (finalText.trim()) h.onFinal(finalText.trim());
    h.onEnd();
  };
  try {
    r.start();
  } catch {
    return null;
  }
  return { stop: () => r.stop() };
}

/** Texte lisible à voix haute : sans markdown ni symboles. PUR, testé. */
export function speakable(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, '')
    .replace(/^\s*\|.*\|\s*$/gm, '')
    .replace(/[*_`#>]/g, '')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/€\s?HT/g, 'euros hors taxes')
    .replace(/€/g, 'euros')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

export function speak(text: string, onEnd?: () => void): void {
  if (!canSpeak()) return onEnd?.();
  const s = window.speechSynthesis;
  s.cancel();
  const u = new SpeechSynthesisUtterance(speakable(text));
  u.lang = 'fr-FR';
  const fr = s.getVoices().find((v) => v.lang?.toLowerCase().startsWith('fr'));
  if (fr) u.voice = fr;
  u.rate = 1.05;
  u.onend = () => onEnd?.();
  u.onerror = () => onEnd?.();
  s.speak(u);
}

export const stopSpeaking = () => canSpeak() && window.speechSynthesis.cancel();

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
