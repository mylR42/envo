/**
 * Hors ligne : un seul état pour toute l'appli.
 *
 * - `online` : le réseau répond (navigator.onLine ET la dernière requête a abouti) ;
 * - `since` : date de la copie servie par le service worker (`x-envo-offline`),
 *   la plus ANCIENNE vue depuis la coupure — c'est elle qu'on annonce.
 *
 * Les copies (Cache Storage) sont effacées à la déconnexion et quand un autre
 * compte se connecte sur l'appareil : jamais les données d'un autre compte.
 */
import { useSyncExternalStore } from 'react';

type State = { online: boolean; since: string | null };
let state: State = { online: typeof navigator === 'undefined' ? true : navigator.onLine, since: null };
const subs = new Set<() => void>();
const set = (s: Partial<State>) => {
  const next = { ...state, ...s };
  if (next.online === state.online && next.since === state.since) return;
  state = next;
  subs.forEach((f) => f());
};

/** Appelé par le client de l'API à chaque réponse (ou échec). */
export function noteResponse(r: { offlineCopy: string | null } | 'echec') {
  if (r === 'echec') return set({ online: false });
  if (r.offlineCopy !== null) {
    const d = r.offlineCopy && r.offlineCopy !== 'aucune' ? r.offlineCopy : null;
    return set({ online: false, since: d && (!state.since || d < state.since) ? d : state.since });
  }
  set({ online: true, since: null });
}

if (typeof window !== 'undefined') {
  window.addEventListener('offline', () => set({ online: false }));
  window.addEventListener('online', () => set({ online: true, since: null }));
}

export const useOffline = () =>
  useSyncExternalStore(
    (f) => (subs.add(f), () => subs.delete(f)),
    () => state,
    () => state,
  );

/** Efface les données gardées pour le hors-ligne (déconnexion, changement de compte). */
export async function clearOfflineData() {
  try {
    if ('caches' in window) await caches.delete('envo-donnees');
  } catch {
    /* rien à effacer */
  }
}

/** Le compte connecté a changé sur cet appareil : on oublie les copies du précédent. */
export async function rememberAccount(userId: string) {
  try {
    const prev = localStorage.getItem('envo.compte');
    if (prev && prev !== userId) {
      await clearOfflineData();
      for (const k of Object.keys(localStorage)) if (k.startsWith('envo.tdb.') && !k.endsWith(userId)) localStorage.removeItem(k);
    }
    localStorage.setItem('envo.compte', userId);
  } catch {
    /* navigation privée */
  }
}

/** « 12/11 à 14:32 ». */
export const sinceLabel = (iso: string | null) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : `${d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })} à ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
};

/** Le service worker (production, contexte sécurisé : https ou localhost). */
export function registerServiceWorker() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator) || !window.isSecureContext || import.meta.env.DEV) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* sans service worker : l'appli marche, sans hors-ligne */
    });
  });
}
