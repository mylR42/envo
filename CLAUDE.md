# CLAUDE.md

Guide pour Claude Code sur ce dépôt.

## Le projet

**Envo** : l'assistante administrative de l'artisan du bâtiment, mobile d'abord
(utilisable sur ordinateur). Première fonction : **AssistDevis**, qui prépare un
devis avec l'artisan, à la voix ou au clavier, et le crée dans **Interfast**.

Écrans : écran d'entrée (comptes), **Tableau de bord**, **AssistDevis**,
**Paramètres**. Version : `version` de `package.json`, affichée sur l'écran
d'entrée et dans Paramètres.

Stack reprise de **Pixo** (demande du propriétaire, 07/11/2026) — voir le
`CLAUDE.md` de Pixo pour les leçons qui valent ici aussi (jsonb en texte, CSP,
polices embarquées, pièges Safari).

## ⚠️ Les données sont dans Interfast, et nulle part ailleurs

Clients, chantiers, devis, articles, prix : **Interfast** (logiciel de gestion
des artisans), interrogé par son **serveur MCP**. La base d'Envo ne garde que :
comptes et sessions, réglages (dont la clé Interfast, chiffrée), conversations
(pour reprendre une séance), actions d'écriture proposées (trace), et le **REX**.
Ne jamais y recopier des devis ou des clients.

**Le MCP Interfast** : dans Interfast, profil → Clés API → « Ajouter une clé »,
puis le **lien du serveur MCP** affiché sous la clé (offre Business, une clé par
entreprise). L'artisan colle l'URL (et la clé si elle n'est pas dans l'URL) dans
Paramètres → Connexion à Interfast. ⚠️ La documentation d'Interfast
(`help.inter-fast.co`, `developers.inter-fast.fr`) n'était pas joignable depuis
l'environnement de développement : **rien dans le code ne suppose un nom d'outil
Interfast**. `server/mcp.ts` lit `tools/list` et donne les outils tels quels à
l'assistante (préfixe `if_`). La clé part en `Authorization: Bearer`.

## L'assistante (`server/agent.ts`, `server/prompt.ts`)

Claude (`claude-opus-5-5` par défaut, `ANTHROPIC_MODEL`, effort `medium`) par le
SDK officiel `@anthropic-ai/sdk`, avec le repli serveur (`fallbacks: "default"`).
Boucle d'outils écrite à la main, parce qu'elle doit S'ARRÊTER pour l'artisan.

- ⚠️ **AUCUNE ÉCRITURE DANS INTERFAST SANS « VALIDER ».** `isWriteTool()` :
  l'annotation `readOnlyHint` fait foi, sinon le nom, et **dans le doute c'est
  une écriture**. Une écriture met la boucle en attente (`conversations.pending`,
  table `actions`), l'écran montre les arguments, et l'outil part du SERVEUR
  au « Valider » avec ces arguments exacts. Un message tapé pendant l'attente
  n'exécute rien. Ne jamais assouplir.
- Outils locaux : `proposer_choix` (question à boutons — attend la réponse),
  `afficher_brouillon` (tableau du devis, n'écrit rien), `memoriser` et
  `rechercher_rex` (le REX).
- ⚠️ **Historique en AJOUT SEUL** : chaque message est gardé tel que l'API l'a
  rendu (réflexion comprise) et rejoué tel quel. Tous les `tool_use` d'une
  réponse reçoivent leurs `tool_result` dans UN message (`pending.done` les garde
  pendant l'attente). Pas de `tool_choice` forcé (refusé par ce modèle).
- ⚠️ **Le contexte d'une séance est FIGÉ à sa création** (`conversations.context` :
  réglages, REX, dernières séances, date). Le réécrire en cours de séance
  casserait le cache et la réflexion déjà faite. Outils TRIÉS pour la même raison.
- Réponse d'un tour en **SSE** (`status` puis `done`) : l'écran voit ce qu'elle
  fait, et une connexion coupée n'interrompt pas le tour, enregistré quand même.
- `server/view.ts` (PUR) convertit l'historique en éléments d'écran : l'écran ne
  lit jamais le format de l'API.

## Tableau de bord Interfast (`server/overview.ts`)

Les noms d'outils Interfast étant inconnus d'avance, une collecte par Claude
choisit les appels et publie par l'outil local `publier_tableau` (indicateurs,
devis à relancer, factures impayées, derniers devis, à venir, `manques`,
`resume`). ⚠️ **Lecture seule** : seuls les outils `!isWriteTool` sont proposés.
⚠️ **Aucun chiffre inventé** : `null` → tiret, et `manques` le dit ; `sanitize()`
borne tout. Résultat **en mémoire** 30 min par compte (jamais en base),
⚠️ **La lecture est une TÂCHE du serveur, pas un flux** (0.5.0, « network
error » le 09/11/2026) : `POST /api/interfast/overview` la lance et répond 202
tout de suite ; l'écran suit `GET /api/interfast/overview/progress` chaque
seconde (appels un par un, phase, `estimateMs` = durée de la précédente,
`settings.overview_stats`). 12 lectures par heure. Sonnet 5.5 y tourne en
`thinking: between_tools`.
⚠️ **Vitesse** (20 s et plus mesurés sur un vrai compte le 09/11/2026) : la
« recette » (`settings.overview_recipe` : outils + arguments de la dernière
collecte, aucune donnée métier) est REJOUÉE en parallèle avant Claude, qui n'a
plus qu'à publier ; modèle `ANTHROPIC_MODEL_TABLEAU` (Sonnet 5.5 par défaut) ;
le tableau reste 24 h en mémoire (« à rafraîchir » au-delà de 30 min) et une
copie vit sur l'appareil (`localStorage`) : l'écran s'affiche tout de suite et
se met à jour derrière. Changer d'URL Interfast efface la recette.
Graphiques : `ui/Charts.tsx`, SVG maison (aucune bibliothèque, CSP `'self'`),
palette `--series-1…4` validée par le script dataviz, couleur FIXE par statut
(`statusSlot`), vue tableau toujours disponible (bascule `envo.vue`).
`GET /api/interfast/status` : vrai contact à chaque appel (délai, outils) +
activité de la semaine (`tool_log`). Les réponses SSE passent par `sse()` :
`X-Accel-Buffering: no` et un ping toutes les 15 s (nginx coupe à 60 s de silence).

## REX (retours d'expérience)

Table `rex` : `decision`, `preference`, `tarif`, `client`, `methode` (écrits par
l'assistante via `memoriser`, ou par l'artisan dans Paramètres → Mémoire) et
`avis` (fin de séance). Les 40 plus utilisés + les 8 derniers avis entrent dans
le contexte de chaque nouvelle séance ; `rechercher_rex` compte les usages.
L'artisan voit, corrige et supprime tout dans Paramètres : rien de caché.

## Voix (`src/lib/voice.ts`)

Web Speech API (dictée fr-FR, lecture `speechSynthesis`), aucun service tiers.
Absente (Firefox) → le micro disparaît. Sur iPhone, l'écoute ne démarre que
pendant un appui. ⚠️ À la voix, **seule une formule explicite valide une
écriture** (`voiceDecision` : « je valide »… ; un « oui » seul ne suffit pas).
Mode mains libres : micro rouvert après chaque réponse lue.
Chaque réponse a son bouton « Écouter ». ⚠️ La lecture passe par `chunks()`
(morceaux ≤ 220 caractères aux fins de phrase, en file) : Chrome coupe un
énoncé long au bout de ~15 s. `speak()` est annulable (`stopSpeaking`, compteur
de séance) et `speakable()` dit « euros hors taxes », « pour cent ».

## En-tête

⚠️ **Un en-tête sur CHAQUE écran** (demande du 09/11/2026) : `.apphead` dans
`App.tsx` (logo + « Envo », écran en cours, initiales → Paramètres), collé en
haut, hauteur `--apphead` (encoche comprise) que la conversation et les
éléments collants (`.jump`) déduisent. Masqué à partir de 1024 px, où la barre
latérale porte la marque. Un nouvel écran n'a rien à faire : il en hérite.
⚠️ Le **numéro de version** est affiché en petit à droite de « Envo » (`.ver`,
en-tête, barre latérale, écran d'entrée) : c'est ce qui permet de voir d'un
coup d'œil quelle version tourne. Le monter à chaque livraison.

## Comptes et sécurité

Voir `SECURITE.md`. Inscription par code e-mail ; **connexion en deux temps**
(mot de passe → `second` → code e-mail) ; mot de passe oublié par code.
Mêmes règles que Pixo : réponses identiques que l'adresse existe ou non, cookie
HttpOnly (SHA-256 en base), anti-CSRF par `Origin`, filtrage par `user_id`.
Sans Mailjet, les codes sont écrits dans le journal du serveur.

## Stack et structure

```
server/app.ts      l'API (Hono), dépendances injectées (db, mailer, llm, mcpFactory, now)
server/agent.ts    la boucle de l'assistante, outils locaux, validation des écritures
server/prompt.ts   consigne fixe + contexte figé d'une séance (pur)
server/view.ts     historique → éléments d'écran (pur)
server/mcp.ts      client MCP « Streamable HTTP » écrit à la main, isWriteTool()
server/llm.ts      appel à Claude (SDK), seul endroit qui parle à Anthropic
server/crypto.ts   AES-256-GCM des secrets en base
server/db.ts       schéma (créations idempotentes ; évolutions en ADD COLUMN IF NOT EXISTS)
src/screens/       AuthScreen, Dashboard, AssistDevis, Settings
src/lib/           api (dont le flux SSE), voice, format (totaux du brouillon)
tests/server/      l'API sur PGlite avec faux Claude et faux serveur MCP Interfast
tools/demo-server.ts  démo sur un port (interface + API, /demo = connecté d'office, scénario rejoué par séance) — exclu du déploiement
```

React 19 + TypeScript strict + Vite ; Node 22 + Hono + `postgres` ; serveur
compilé par esbuild en un seul fichier ; icônes **Phosphor PARTOUT** (demande du
09/11/2026) : chaque écran passe par `ui/PageHead.tsx` (icône `light`), chaque
titre de carte et chaque bouton porte une icône (`regular`, `bold` sous 16 px et
pour l'onglet actif, jamais `fill` sauf les étoiles de note) ; jamais d'emoji.
Les noms techniques d'Interfast s'affichent en français par `fieldLabel()` /
`toolLabel()` (`lib/format.ts`, testés) ;
police Manrope embarquée. Identité « atelier » (bleu de travail, jaune pour la
voix), volontairement différente de Pixo.

## Commandes

```bash
npm run dev / npm run dev:api   # interface (proxy /api → 127.0.0.1:3880) / API
npm test                        # vitest (PGlite, faux Claude, faux Interfast)
npm run typecheck               # navigateur ET serveur
npm run build                   # dist/ + dist-server/server.mjs
```

Lancer `npm test` et `npm run typecheck` avant tout commit. Une interface se
REGARDE : `tools/demo-server.ts` (mode d'emploi en tête) + `npx vite preview`,
puis Playwright en iPhone 13 et à 1440 px.

## À faire avant la production

- Vérifier sur un vrai compte Interfast (offre Business) : forme de l'URL MCP,
  passage de la clé, noms et annotations des outils, création réelle d'un devis.
- Liste blanche des hôtes MCP (rebond DNS, voir `SECURITE.md`).

## Déploiement

Détail dans `DEPLOY.md`. Modèle Pixo : la CI publie la branche `dist` depuis
`main`, le VPS (`/srv/envo`, port 3880, `envo-api.service`) la tire chaque
minute, contrôle l'adresse publique et revient en arrière sinon. **Un merge sur
`main` met en ligne.** On ne compile jamais sur le VPS. ⚠️ `ENVO_SECRET_KEY`
(dans `/srv/envo/envo.env`) est tirée une fois et ne doit jamais changer.
nginx : la route `…/turn` n'est pas mise en tampon (SSE, 600 s) ; le micro est
autorisé (`Permissions-Policy`) — sans lui, plus de dictée.

## Versions

Monter `version` de `package.json` à CHAQUE livraison, et une ligne en tête de
`CHANGELOG.md`.

## Git

- Branches de travail : `claude/<description>`.
- Ne pas ouvrir de pull request sans demande explicite.
