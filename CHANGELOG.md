# Journal des versions

## 0.1.1 — 09/11/2026

- Déploiement sur le VPS (modèle Pixo) : la CI publie la branche `dist` depuis `main`, le VPS la tire chaque minute, contrôle public puis retour arrière en cas d’échec. Installation : `deploy/install-vps.sh`, voir `DEPLOY.md`.
- Micro autorisé par les en-têtes de sécurité ; réponses de l’assistante en flux non mises en tampon par nginx (10 min au plus).
- Sauvegarde nocturne vérifiée de la base.
- Test du scénario complet sur un vrai PostgreSQL (CI).
- Démonstration sur un seul port (`/demo`).

## 0.1.0 — 07/11/2026

Premier prototype.

- Comptes : inscription validée par code e-mail, connexion en deux temps (mot de passe puis code e-mail), mot de passe oublié par code, changement de mot de passe avec alerte.
- Paramètres : entreprise, habitudes de chiffrage (taux horaire, TVA, marge, déplacement, validité, consignes), connexion Interfast (URL du serveur MCP + clé chiffrée, test qui liste les outils), mémoire de l’assistante (REX) consultable et modifiable.
- Tableau de bord : nouveau devis (dicté ou écrit), « faire le point », séances en attente, devis créés dans Interfast, mémoire, note moyenne, état d’Interfast.
- AssistDevis : conversation avec Claude branchée sur le MCP Interfast ; questions à choix, brouillon chiffré (HT / TVA / TTC), validation obligatoire de toute écriture dans Interfast, mémorisation des décisions, avis de fin de séance réinjectés ; voix (dictée, lecture des réponses, mains libres).
