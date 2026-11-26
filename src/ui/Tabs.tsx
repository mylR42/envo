/**
 * Barre d'onglets d'un écran (Paramètres, et tout écran qui en a besoin) :
 * un onglet = une partie, et SEULE la partie choisie est affichée (demande du
 * 26/11/2026). L'onglet actif est en surbrillance. Chaque onglet est un LIEN
 * (`#/ecran/partie`) : le retour arrière du téléphone revient à l'onglet
 * précédent, et un lien venu d'ailleurs (« Connectez Interfast ») ouvre le bon.
 */
import type { Icon } from '@phosphor-icons/react';

export interface TabDef {
  id: string;
  label: string;
  icon: Icon;
}

/** L'onglet demandé s'il existe, sinon le premier. PUR. */
export const activeTab = (tabs: readonly TabDef[], wanted: string | undefined) => (tabs.some((t) => t.id === wanted) ? wanted! : tabs[0]!.id);

export function Tabs({ tabs, active, base, label }: { tabs: readonly TabDef[]; active: string; base: string; label: string }) {
  return (
    <nav className="jump tabsbar" role="tablist" aria-label={label}>
      {tabs.map(({ id, label: l, icon: I }) => {
        const on = id === active;
        return (
          <a key={id} role="tab" aria-selected={on} aria-current={on ? 'page' : undefined} className={on ? 'is-on' : ''} href={`#${base}/${id}`}>
            <I size={18} weight={on ? 'bold' : 'regular'} /> {l}
          </a>
        );
      })}
    </nav>
  );
}
