# Journal des versions

## 0.4.0 — 09/11/2026

Tableau de bord : l’essentiel d’abord, des graphiques, et plus vite.
- Le grand pavé « Nouveau devis » laisse la place à deux boutons dans l’en-tête (Dicter, Nouveau devis).
- « À traiter » en tête : devis à relancer (montant en jeu), impayés, séances à reprendre — un appui y mène.
- Six indicateurs sur une rangée (grand écran), à l’euro près.
- « Évolution sur 6 mois », en graphiques OU en tableaux (bascule mémorisée) : CA facturé par mois, devis émis par mois selon leur statut, portefeuille de devis par statut, impayés par ancienneté. Graphiques en SVG maison (aucune bibliothèque), palette validée, info-bulle au survol et au clavier.
- Vitesse : le dernier tableau s’affiche tout de suite (mémoire du serveur 24 h, copie sur l’appareil) et se rafraîchit derrière s’il a plus de 30 min ; les appels Interfast de la dernière lecture sont rejoués d’emblée, en parallèle, et l’assistante n’a plus qu’à calculer (un passage au lieu de deux ou trois) ; la lecture du tableau passe par un modèle plus rapide (`ANTHROPIC_MODEL_TABLEAU`, Claude Sonnet 5.5 par défaut).

## 0.3.0 — 09/11/2026

Un vrai tableau de bord, branché sur Interfast.
- « Mon activité dans Interfast » : résumé du jour, indicateurs (devis en attente et leur montant, devis acceptés ce mois, taux de transformation, CA facturé du mois, factures impayées), devis à relancer (un appui ouvre une séance de relance), factures impayées, derniers devis, planning des 14 jours.
- Lu dans Interfast en LECTURE SEULE par l’assistante (aucun outil qui modifie n’est proposé), gardé 30 minutes en mémoire (rien en base), bouton « Actualiser ». Un chiffre non fourni par Interfast est un tiret, et la liste « Ce qu’Interfast ne permet pas de savoir » le dit.
- Carte « Connexion Interfast » : état, serveur, clé, temps de réponse, outils en lecture / qui modifient, appels et erreurs de la semaine, dernier échange, outils les plus utilisés.
- Réponses en flux protégées derrière nginx (pas de mise en tampon, signal de vie toutes les 15 s).

## 0.2.0 — 09/11/2026

Icônes Phosphor partout et ergonomie revue.
- Un en-tête commun à chaque écran (icône, titre, explication, actions) ; une icône sur chaque titre de carte.
- Conversation : titre lisible sur deux lignes, état avec icône, « Terminer » en bouton visible ; la voix passe dans une barre dédiée aux libellés clairs (« Lire les réponses », « Mains libres ») au lieu de deux icônes muettes.
- Les noms techniques d’Interfast sont traduits (« create_quote » → « Créer devis », « unit_price » → « PU HT »).
- Tableau de bord : quatre tuiles compactes (deux par ligne sur téléphone), la note moyenne passe dans « Dernières séances ».
- Listes de séances : icône d’état (à votre tour, devis créé, en cours) et flèche.
- Paramètres : raccourcis vers chaque section, collés en haut pendant le défilement.
- Une séance vide s’ouvre en haut (titre, micro, suggestions) au lieu d’être défilée.

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
