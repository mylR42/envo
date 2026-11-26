/**
 * En-tête d'écran : icône Phosphor + titre + phrase d'explication + actions.
 * UN seul composant pour tous les écrans, pour que les titres se ressemblent.
 * Icônes : trait `light` en grand, `regular` ailleurs, jamais `fill` (règle Pixo).
 *
 * Téléphone (26/11/2026, « du texte qui prend beaucoup de place ») : la phrase
 * d'explication est REPLIÉE derrière un bouton ⓘ ; elle reste lisible en entier
 * à partir de 640 px.
 */
import { Info } from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import { useState, type ReactNode } from 'react';

export function PageHead({ icon: I, title, children, actions }: { icon: Icon; title: string; children?: ReactNode; actions?: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <header className="page__head">
      <div className="page__title">
        <span className="page__icon" aria-hidden="true">
          <I size={28} weight="light" />
        </span>
        <div className="page__titletext">
          <h1>
            {title}
            {children && (
              <button type="button" className="page__info" aria-expanded={open} aria-label={open ? 'Masquer l’explication' : 'À quoi sert cet écran ?'} onClick={() => setOpen(!open)}>
                <Info size={18} weight={open ? 'bold' : 'regular'} />
              </button>
            )}
          </h1>
          {children && <p className={`muted page__desc${open ? ' is-open' : ''}`}>{children}</p>}
        </div>
      </div>
      {actions && <div className="page__actions">{actions}</div>}
    </header>
  );
}
