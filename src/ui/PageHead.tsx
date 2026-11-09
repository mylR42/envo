/**
 * En-tête d'écran : icône Phosphor + titre + phrase d'explication + actions.
 * UN seul composant pour tous les écrans, pour que les titres se ressemblent.
 * Icônes : trait `light` en grand, `regular` ailleurs, jamais `fill` (règle Pixo).
 */
import type { Icon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';

export function PageHead({ icon: I, title, children, actions }: { icon: Icon; title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page__head">
      <div className="page__title">
        <span className="page__icon" aria-hidden="true">
          <I size={28} weight="light" />
        </span>
        <div>
          <h1>{title}</h1>
          {children && <p className="muted">{children}</p>}
        </div>
      </div>
      {actions && <div className="page__actions">{actions}</div>}
    </header>
  );
}
