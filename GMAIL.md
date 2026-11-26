# Gmail dans Envo — étude (26/11/2026)

Demande : « voir comment je peux me connecter à une adresse Gmail afin de tout
gérer depuis Envo et la voix ». Ce document compare les façons de faire et
recommande un ordre. **Rien n'est encore codé.**

## Ce qu'on veut pouvoir faire

À l'écran ou à la voix (Siri, mains libres) :

- « Ai-je reçu une réponse de Mme Leroy ? » — **chercher et lire** des e-mails ;
- « Résume-moi les mails de ce matin » — **lister** les non lus ;
- « Réponds-lui que je passe jeudi » — **préparer un brouillon** ;
- « Envoie le devis D-2026-0099 à M. Dupont » — **envoyer**, pièce jointe comprise ;
- relier un e-mail à Interfast (le client, le devis, le chantier).

## Les règles d'Envo qui s'appliquent telles quelles

- **Les e-mails restent dans Gmail.** Comme pour Interfast, Envo n'en recopie
  aucun en base ; il les lit à la demande et oublie.
- **Aucun envoi sans « Valider »** (« je valide » à la voix) : envoyer un e-mail
  est une écriture, traitée exactement comme une création dans Interfast
  (`isWriteTool`, `pending`, table `actions`). Chercher, lire, préparer un
  brouillon dans Gmail : sans validation.
- **Le secret est chiffré** (AES-256-GCM, comme la clé Interfast) et ne repart
  jamais au navigateur. Révocable dans Paramètres.

Côté code, ce sont quatre ou cinq **outils locaux de l'assistante**
(`mail_chercher`, `mail_lire`, `mail_brouillon`, `mail_envoyer`), à côté des
outils Interfast : la voix, Siri et la validation marchent sans rien de plus.

## Trois façons de se connecter

### 1. IMAP + SMTP avec un « mot de passe d'application » — le plus rapide

L'artisan active la validation en deux étapes de son compte Google, crée un
**mot de passe d'application** (Compte Google → Sécurité → Mots de passe des
applications), et le colle dans Paramètres → Gmail avec son adresse. Envo se
connecte à `imap.gmail.com:993` (lire, chercher, brouillons) et
`smtp.gmail.com:465` (envoyer).

- ✅ Aucune démarche auprès de Google, faisable en quelques jours.
- ✅ Hôtes fixes : pas de risque de sonder le réseau interne (contrairement à
  une URL saisie).
- ⚠️ Google pousse vers OAuth et a déjà restreint ces accès : **à vérifier sur
  un vrai compte** que les mots de passe d'application sont toujours proposés
  (ils ne le sont pas sans validation en deux étapes, ni avec la Protection
  avancée, et un administrateur Google Workspace peut les interdire).
- ⚠️ Le mot de passe d'application donne accès à toute la boîte : il doit être
  traité comme la clé Interfast (chiffré, jamais affiché, révocable chez Google).
- Dépendance : une bibliothèque IMAP (ex. `imapflow`) et SMTP (`nodemailer`).

### 2. API Gmail avec connexion Google (OAuth) — la voie « propre »

Bouton « Se connecter avec Google », l'artisan accepte, Envo garde un jeton de
rafraîchissement chiffré et appelle l'API Gmail.

- ✅ Pas de mot de passe à copier, accès révocable en un clic, droits limités
  (lecture seule, ou envoi seul).
- ⚠️ Les droits Gmail de lecture sont des **droits « restreints »** chez Google :
  pour une application ouverte au public, il faut faire **valider l'application
  par Google**, avec une **évaluation de sécurité annuelle** par un organisme
  agréé (plusieurs semaines, coût annuel). Tant qu'elle n'est pas validée,
  l'application reste « en test » : 100 comptes déclarés à la main au plus, et
  la connexion est à refaire chaque semaine.
- Pour un seul artisan (ou quelques-uns, déclarés comme testeurs), c'est
  utilisable tout de suite, avec la reconnexion hebdomadaire.
- Exception : une adresse Google **Workspace** (domaine de l'entreprise) peut
  autoriser l'application comme « interne » sans validation publique.

### 3. Un serveur MCP Gmail

Même principe qu'Interfast : Envo lirait les outils d'un serveur MCP qui parle
à Gmail. Il n'existait pas, à la date de l'étude, de serveur MCP Gmail officiel
de Google que nous ayons pu vérifier ; un serveur tiers voudrait dire confier
la boîte de l'artisan à un tiers. **Écarté** pour l'instant.

## Recommandation

1. **Maintenant : la voie 1 (IMAP/SMTP + mot de passe d'application)**, après un
   essai sur le vrai compte Gmail du propriétaire pour confirmer que Google
   propose toujours ces mots de passe. Lecture, recherche, brouillons, envoi
   validé, à l'écran et à la voix.
2. **Si Envo s'ouvre à d'autres artisans** : la voie 2 (OAuth), en lançant tôt
   la validation Google, qui est longue ; l'IMAP reste en secours.

## Ce qu'il faudrait pour démarrer la voie 1

- Le propriétaire crée un mot de passe d'application sur son compte (essai).
- Paramètres → **Gmail** : adresse, mot de passe d'application, bouton « Tester ».
- `server/mail-gmail.ts` : connexion IMAP/SMTP, outils `mail_*` donnés à
  l'assistante, `mail_envoyer` traité comme une écriture (validation).
- Siri : rien à faire, la route `/api/voix` utilise déjà le même tour.
- Tests : faux serveur IMAP/SMTP, comme le faux Interfast.
