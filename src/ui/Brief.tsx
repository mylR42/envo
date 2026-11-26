import { CaretDown, CaretUp, Sparkle, SpeakerHigh, Stop } from '@phosphor-icons/react';
import { useEffect, useState, type ReactNode } from 'react';
import { canSpeak, speak, stopSpeaking } from '../lib/voice';

/**
 * Un texte de l'assistante (le point du jour, le point de la semaine…) en CARTE : replié sur deux lignes (il peut
 * en faire sept sur un téléphone et repoussait l'essentiel hors de l'écran,
 * signalé le 09/11/2026), « Lire la suite » et « Écouter ». Sur téléphone, les
 * longs textes passent par lui (26/11/2026 : « du texte qui prend beaucoup de
 * place : mets plus de cartes, on clique dessus ou on les écoute »).
 */
export function Brief({ label, text, at = null, icon }: { label: string; text: string; at?: string | null; icon?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [talking, setTalking] = useState(false);
  useEffect(() => () => stopSpeaking(), []);
  const long = text.length > 140;
  return (
    <section className={`brief card${open ? ' is-open' : ''}`} aria-label={label}>
      <span className="brief__icon" aria-hidden="true">
        {icon ?? <Sparkle size={20} />}
      </span>
      <div className="brief__body">
        <span className="brief__label">
          {label}{at && <> · {new Date(at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</>}
        </span>
        <p className="brief__text">{text}</p>
        <div className="brief__actions">
          {long && (
            <button className="link-btn" onClick={() => setOpen(!open)} aria-expanded={open}>
              {open ? (
                <>
                  <CaretUp size={14} /> Réduire
                </>
              ) : (
                <>
                  <CaretDown size={14} /> Lire la suite
                </>
              )}
            </button>
          )}
          {canSpeak() && (
            <button
              className="link-btn"
              aria-pressed={talking}
              onClick={() => {
                if (talking) {
                  stopSpeaking();
                  setTalking(false);
                } else {
                  setTalking(true);
                  speak(text, () => setTalking(false));
                }
              }}
            >
              {talking ? (
                <>
                  <Stop size={14} weight="bold" /> Arrêter
                </>
              ) : (
                <>
                  <SpeakerHigh size={14} /> Écouter
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

