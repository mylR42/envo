# Envo — votre assistant personnel

Prototype : un artisan prépare ses devis en parlant (ou en écrivant) à une assistante IA branchée sur **Interfast** par MCP. Elle retrouve le client et les devis passés, pose les questions utiles avec des réponses proposées, montre un brouillon chiffré, crée le devis dans Interfast **après validation**, et retient les décisions d’une séance à l’autre.

## Tester

**1. La démonstration (aucune clé, rien à installer à part Node 22)** — assistante scénarisée, faux Interfast, base en mémoire :

```bash
npm install && npm run build
npx esbuild tools/demo-server.ts --bundle --platform=node --format=esm --packages=external --outfile=.demo/demo.mjs
node .demo/demo.mjs
```

Ouvrir http://localhost:4173/demo : connecté d’office (« Paul Dupont », Interfast branché sur le faux serveur). L’assistante rejoue toujours le même scénario (chauffe-eau chez M. Dupont), quoi qu’on lui dise ; chaque nouvelle séance le reprend au début. Pour essayer l’inscription : http://localhost:4173/ puis le code sur http://localhost:4173/demo/code.

**2. Les tests automatiques** : `npm test && npm run typecheck`.

**3. Avec la vraie assistante et le vrai Interfast** : PostgreSQL, puis les variables de `.env.example` (au minimum `ENVO_SECRET_KEY`, `ANTHROPIC_API_KEY`), `npm run dev:api` et `npm run dev`. Sans Mailjet, les codes de connexion s’affichent dans le terminal de l’API. Dans l’app : Paramètres → Connexion à Interfast.

## Brancher Interfast

Dans Interfast (offre Business) : profil → Clés API → « Ajouter une clé », copier le lien du serveur MCP affiché sous la clé. Dans Envo : Paramètres → Connexion à Interfast → coller l’URL (et la clé si elle n’est pas dans l’URL) → « Tester la connexion » liste les outils, marqués Lecture ou Modifie.

Voir `CLAUDE.md` (architecture et règles) et `SECURITE.md`.
