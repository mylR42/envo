/**
 * Les popins d’Envo : JAMAIS `alert()` ni `confirm()` (demande du propriétaire,
 * 05/11/2026). Une fenêtre du navigateur parle au nom du site (« envo… indique »),
 * ne se met pas en forme, et ne dit pas ce qui va se passer.
 *
 * Centrée sur tous les écrans, Échap ou le voile annulent, le bouton d'annulation
 * a le focus : un Entrée réflexe ne supprime rien.
 */
import { useEffect, useRef, type ReactNode } from 'react';

export function Popin(props: {
  icon?: ReactNode;
  tone?: 'danger' | 'neutre' | 'succes';
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  /** Sans `cancelLabel`, la popin n'a qu'un bouton (information). */
  cancelLabel?: string;
  busy?: boolean;
  disabled?: boolean;
  onConfirm(): void;
  onCancel?(): void;
}) {
  const { tone = 'neutre', busy, onCancel } = props;
  const cancelRef = useRef<HTMLButtonElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    (props.cancelLabel ? cancelRef : okRef).current?.focus();
    const k = (e: KeyboardEvent) => e.key === 'Escape' && !busy && (onCancel ?? props.onConfirm)();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- focus posé une fois à l'ouverture
  }, [busy]);
  return (
    <div className="popin" role="alertdialog" aria-modal="true" aria-label={props.title} onClick={(e) => e.target === e.currentTarget && !busy && onCancel?.()}>
      <div className={`popin__card popin__card--${tone}`}>
        <div className="popin__head">
          {props.icon && <span className="popin__icon">{props.icon}</span>}
          <h2 className="popin__title">{props.title}</h2>
        </div>
        {props.children && <div className="popin__body">{props.children}</div>}
        <div className="popin__actions">
          {props.cancelLabel && (
            <button ref={cancelRef} className="btn" onClick={onCancel} disabled={busy}>
              {props.cancelLabel}
            </button>
          )}
          <button ref={okRef} className={`btn ${tone === 'danger' ? 'btn--danger-solid' : 'btn--primary'}`} onClick={props.onConfirm} disabled={busy || props.disabled}>
            {busy ? 'Un instant…' : props.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
