/**
 * Vérifie les écrans comme sur un iPhone : zones sûres SIMULÉES (barre d'état
 * de 59 px, barre d'accueil de 34 px) et barre d'état HACHURÉE par-dessus la
 * page — rien de lisible ne doit passer dessous. Chromium n'a pas d'encoche :
 * sans cette simulation, le défaut du 12/11/2026 (« Envo » flouté sous la barre
 * d'état, connexion collée en haut) ne se voit pas.
 *
 *   node tools/demo-server… (voir tools/demo-server.ts)   puis
 *   node tools/verifier-iphone.cjs [http://localhost:4173]
 *
 * Écrit les captures dans ./captures-iphone/ et ÉCHOUE (code 1) si :
 * - un texte commence sous la barre d'état ;
 * - l'écran d'entrée n'est pas centré (écart haut/bas > 24 px) ou défile.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = process.argv[2] || 'http://localhost:4173';
const SIM = `:root{--safe-top:59px!important;--safe-bottom:34px!important}
body::after{content:'';position:fixed;inset:0 0 auto 0;height:59px;background:repeating-linear-gradient(45deg,rgba(255,0,0,.35) 0 6px,transparent 6px 12px);z-index:9999;pointer-events:none}`;

(async () => {
  fs.mkdirSync('captures-iphone', { recursive: true });
  const b = await chromium.launch();
  const fails = [];
  for (const [name, w, h] of [['iphone-15-pro', 393, 852], ['iphone-se', 375, 667], ['iphone-plus', 430, 932]]) {
    const p = await (await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })).newPage();
    await p.goto(`${BASE}/`);
    await p.waitForSelector('.auth__card');
    await p.addStyleTag({ content: SIM });
    await p.waitForTimeout(200);
    await p.screenshot({ path: `captures-iphone/entree-${name}.png` });
    const m = await p.evaluate(() => {
      const brand = document.querySelector('.auth .brand').getBoundingClientRect();
      const card = document.querySelector('.auth__card').getBoundingClientRect();
      // Espace libre visible : au-dessus de la marque (barre d'état déduite), sous la carte (barre d'accueil déduite).
      return { top: brand.top - 59, bottom: innerHeight - 34 - card.bottom, scroll: document.documentElement.scrollHeight - innerHeight };
    });
    if (m.top < 12) fails.push(`${name} : la marque touche la barre d'état (${Math.round(m.top)} px)`);
    if (m.scroll > 0) fails.push(`${name} : l'écran d'entrée défile (${m.scroll} px)`);
    else if (Math.abs(m.top - m.bottom) > 24) fails.push(`${name} : écran d'entrée décentré (haut ${Math.round(m.top)} px, bas ${Math.round(m.bottom)} px)`);
    console.log(name, JSON.stringify(m));
  }
  await b.close();
  if (fails.length) {
    console.error('ÉCHEC :\n- ' + fails.join('\n- '));
    process.exit(1);
  }
  console.log('OK : rien sous la barre d’état, écran d’entrée centré.');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
