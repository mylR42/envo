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
 * Découpe un texte à lire en morceaux de 220 caractères au plus, aux fins de
 * phrase (puis aux virgules). Chrome coupe un énoncé long au bout de ~15 s, et
 * Safari en perd parfois la fin : une file de phrases courtes se lit en entier.
 * PUR, testé.
 */
export function chunks(text: string, max = 220): string[] {
  const out: string[] = [];
  for (const line of text.split(/\n+/)) {
    const sentences = line.match(/[^.!?;:]+[.!?;:]*\s*/g) ?? [line];
    let cur = '';
    for (const raw of sentences) {
      const sen = raw.trim();
      if (!sen) continue;
      const pieces = sen.length <= max ? [sen] : sen.split(/(?<=,)\s+/);
      for (const p of pieces) {
        if (p.length > max) {
          if (cur) out.push(cur), (cur = '');
          for (let k = 0; k < p.length; k += max) out.push(p.slice(k, k + max));
        } else if ((cur ? cur.length + 1 : 0) + p.length > max) {
          out.push(cur);
          cur = p;
        } else cur = cur ? `${cur} ${p}` : p;
      }
    }
    if (cur) out.push(cur);
  }
  return out.filter((c) => /[\p{L}\p{N}]/u.test(c));
}

let session = 0;

/**
 * Lit un texte (markdown accepté) à voix haute, phrase par phrase. `onEnd` est
 * appelé à la fin ou à l'arrêt. Un nouvel appel interrompt la lecture en cours.
 */
export function speak(text: string, onEnd?: () => void): void {
  if (!canSpeak()) return onEnd?.();
  const s = window.speechSynthesis;
  const mine = ++session;
  s.cancel();
  const parts = chunks(speakable(text));
  const fr = s.getVoices().find((v) => v.lang?.toLowerCase().startsWith('fr'));
  let i = 0;
  const next = () => {
    if (mine !== session) return;
    if (i >= parts.length) return onEnd?.();
    const u = new SpeechSynthesisUtterance(parts[i++]!);
    u.lang = 'fr-FR';
    if (fr) u.voice = fr;
    u.rate = 1.05;
    u.onend = next;
    u.onerror = (e) => (e.error === 'interrupted' || e.error === 'canceled' ? mine === session && onEnd?.() : next());
    s.speak(u);
  };
  next();
}

export const stopSpeaking = () => {
  session++;
  if (canSpeak()) window.speechSynthesis.cancel();
};

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
