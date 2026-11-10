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

import { matchOption, speakable, voiceDecision } from './speech-text';

export { matchOption, speakable, voiceDecision };

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
 * ⚠️ Les énoncés en cours sont gardés ICI : Chrome peut jeter de la mémoire un
 * énoncé encore en lecture, et son `onend` n'arrive alors jamais — la file
 * s'arrête après la première phrase, sans erreur.
 */
const alive = new Set<SpeechSynthesisUtterance>();

/** La voix française du système (les voix arrivent parfois après le chargement). */
function frenchVoice(): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices();
  const fr = voices.filter((v) => v.lang?.toLowerCase().replace('_', '-').startsWith('fr'));
  return fr.find((v) => /fr-fr/i.test(v.lang) && v.localService) ?? fr.find((v) => /fr-fr/i.test(v.lang)) ?? fr[0];
}
if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  // Demander la liste tôt : Chrome ne la remplit qu'après ce premier appel.
  window.speechSynthesis.getVoices();
}

export type SpeakError = 'bloque' | 'indisponible';

/**
 * Lit un texte (markdown accepté) à voix haute, phrase par phrase. `onEnd` est
 * appelé à la fin ou à l'arrêt ; `onError` quand le navigateur refuse (lecture
 * automatique bloquée, aucune voix). Un nouvel appel interrompt le précédent.
 *
 * ⚠️ Chrome laisse tomber SANS ERREUR un `speak()` qui suit immédiatement un
 * `cancel()` : on n'annule que s'il y a quelque chose à annuler, et on attend
 * alors un instant avant de reparler. Sans rien en cours, on parle tout de suite
 * — Safari (iPhone) n'accepte la première lecture que pendant l'appui.
 */
export function speak(text: string, onEnd?: () => void, onError?: (e: SpeakError) => void): void {
  if (!canSpeak()) {
    onError?.('indisponible');
    return onEnd?.();
  }
  const s = window.speechSynthesis;
  const mine = ++session;
  const parts = chunks(speakable(text));
  let i = 0;
  let started = false;
  const finish = () => {
    if (mine === session) onEnd?.();
  };
  const next = () => {
    if (mine !== session) return;
    if (i >= parts.length) return finish();
    const u = new SpeechSynthesisUtterance(parts[i++]!);
    alive.add(u);
    u.lang = 'fr-FR';
    const v = frenchVoice();
    if (v) u.voice = v;
    u.rate = 1.05;
    u.onstart = () => {
      started = true;
    };
    u.onend = () => {
      alive.delete(u);
      next();
    };
    u.onerror = (e) => {
      alive.delete(u);
      if (e.error === 'interrupted' || e.error === 'canceled') return finish();
      if (e.error === 'not-allowed') {
        onError?.('bloque');
        return finish();
      }
      next();
    };
    s.resume(); // Chrome reste parfois « en pause » après une lecture coupée.
    s.speak(u);
  };
  const busy = s.speaking || s.pending;
  if (busy) {
    s.cancel();
    setTimeout(next, 120);
  } else next();
  // Garde-fou : rien n'a démarré au bout de 4 s (lecture bloquée sans erreur).
  setTimeout(() => {
    if (mine === session && !started && i > 0) onError?.('bloque');
  }, 4000);
}

export const stopSpeaking = () => {
  session++;
  if (canSpeak()) {
    const s = window.speechSynthesis;
    if (s.speaking || s.pending) s.cancel();
  }
  alive.clear();
};

