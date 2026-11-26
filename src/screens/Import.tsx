/**
 * Import PDF (menu à part, 26/11/2026 : « tu mélanges deux fonctionnalités »).
 * Un planning de fournisseur ou de sous-traitant en PDF + vos consignes →
 * une proposition ligne à ligne → « Valider l'import ». Le planning, lui, se
 * lit et se modifie dans l'écran Planning.
 */
import { FileArrowUp } from '@phosphor-icons/react';
import { PageHead } from '../ui/PageHead';
import { ImportPanel } from './ImportPanel';

export function Import({ assistant }: { assistant: boolean }) {
  return (
    <div className="page page--import">
      <PageHead icon={FileArrowUp} title="Import PDF">
        Un planning de fournisseur en PDF : donnez vos consignes, Envo prépare l’import dans Interfast, vous validez ligne à ligne.
      </PageHead>
      <ImportPanel assistant={assistant} />
    </div>
  );
}
