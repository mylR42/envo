/*
 * Service worker d'Envo : l'appli et les DERNIÈRES DONNÉES restent utilisables
 * sans réseau (demande du 12/11/2026 : « fonctionner hors ligne avec les
 * dernières données récupérées »).
 *
 * - L'APPLI (index.html, /assets/… : scripts, styles, polices) : copiée à
 *   l'installation ; les fichiers /assets/ portent un nom haché, ils ne changent
 *   jamais → cache d'abord. La page : réseau d'abord (une nouvelle version se voit
 *   tout de suite), copie si pas de réseau.
 * - Les LECTURES de l'API (liste blanche, GET seulement) : réseau d'abord ; la
 *   dernière réponse réussie est gardée, et servie hors ligne avec l'en-tête
 *   `x-envo-offline` = date de la copie : l'écran dit « hors ligne, données du… ».
 * - ⚠️ JAMAIS une écriture (POST, PUT, DELETE) : hors ligne, elle échoue et
 *   l'écran le dit. Rien n'est envoyé en différé à l'insu de l'artisan.
 * - Les copies sont effacées à la déconnexion et au changement de compte
 *   (`caches.delete` depuis la page) : un autre compte ne verra jamais les
 *   données du précédent.
 *
 * Changer ce fichier = monter VERSION : l'ancienne copie de l'appli est jetée.
 */
const VERSION = 'v1';
const SHELL = `envo-appli-${VERSION}`;
const DATA = 'envo-donnees';

/** Lectures gardées pour le hors-ligne (jamais la progression d'une lecture, jamais la santé). */
const READS = /^\/api\/(auth\/me|dashboard|interfast\/status|interfast\/overview|conversations(\/[0-9a-f-]{36})?|settings|rex|account\/voice-tokens)$/;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      const page = await fetch('/', { cache: 'no-cache' });
      const html = await page.clone().text();
      await cache.put('/', page);
      // Scripts et styles de la page, puis les polices citées par les styles.
      const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
      const more = ['/manifest.webmanifest', '/icon.svg'];
      for (const a of assets.filter((x) => x.endsWith('.css'))) {
        try {
          const css = await (await fetch(a)).text();
          more.push(...[...css.matchAll(/url\((\/assets\/[^)]+)\)/g)].map((m) => m[1]));
        } catch {
          /* police manquante : elle sera prise au passage */
        }
      }
      await cache.addAll([...new Set([...assets, ...more])]);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (k.startsWith('envo-appli-') && k !== SHELL) await caches.delete(k);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // les écritures passent, ou échouent : jamais de copie
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          if (res.ok) (await caches.open(SHELL)).put('/', res.clone());
          return res;
        } catch {
          return (await caches.match('/')) ?? new Response('Hors connexion', { status: 503 });
        }
      })(),
    );
    return;
  }

  if (url.pathname.startsWith('/assets/') || url.pathname === '/manifest.webmanifest' || url.pathname === '/icon.svg') {
    event.respondWith(
      (async () => {
        const hit = await caches.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) (await caches.open(SHELL)).put(req, res.clone());
        return res;
      })(),
    );
    return;
  }

  if (READS.test(url.pathname)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(DATA);
        try {
          const res = await fetch(req);
          if (res.ok) {
            const body = await res.clone().arrayBuffer();
            const headers = new Headers(res.headers);
            headers.set('x-envo-cached-at', new Date().toISOString());
            await cache.put(url.pathname + url.search, new Response(body, { status: 200, headers }));
          }
          return res;
        } catch {
          const hit = await cache.match(url.pathname + url.search);
          if (!hit) return new Response(JSON.stringify({ error: 'Hors connexion : cette page n’a pas encore été ouverte avec du réseau.' }), { status: 503, headers: { 'content-type': 'application/json', 'x-envo-offline': 'aucune' } });
          const headers = new Headers(hit.headers);
          headers.set('x-envo-offline', hit.headers.get('x-envo-cached-at') ?? '');
          return new Response(await hit.arrayBuffer(), { status: 200, headers });
        }
      })(),
    );
  }
});
