# Envo — l’assistante de l’artisan

Prototype : un artisan prépare ses devis en parlant (ou en écrivant) à une assistante IA branchée sur **Interfast** par MCP. Elle retrouve le client et les devis passés, pose les questions utiles avec des réponses proposées, montre un brouillon chiffré, crée le devis dans Interfast **après validation**, et retient les décisions d’une séance à l’autre.

## Démarrer en local

```bash
npm install
npm test && npm run typecheck
# Démonstration sans PostgreSQL ni clés (faux Interfast, assistante scénarisée) :
npx esbuild tools/demo-server.ts --bundle --platform=node --format=esm --packages=external --outfile=.demo/demo.mjs && node .demo/demo.mjs &
npm run build && npx vite preview    # http://localhost:4173 — le code de connexion s’affiche dans le terminal du serveur
```

Avec un vrai PostgreSQL et de vraies clés : renseigner les variables de `.env.example`, puis `npm run dev:api` et `npm run dev`.

## Brancher Interfast

Dans Interfast (offre Business) : profil → Clés API → « Ajouter une clé », copier le lien du serveur MCP affiché sous la clé. Dans Envo : Paramètres → Connexion à Interfast → coller l’URL (et la clé si elle n’est pas dans l’URL) → « Tester la connexion » liste les outils, marqués Lecture ou Modifie.

Voir `CLAUDE.md` (architecture et règles) et `SECURITE.md`.
