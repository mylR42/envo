# Sécurité d’Envo — attaque → protection

| Attaque | Protection |
|---|---|
| Vol de mot de passe | Connexion en deux temps : mot de passe puis code à 6 chiffres par e-mail (15 min, 5 essais). |
| Force brute | 10 échecs par IP + adresse = 15 min de pause ; codes limités en essais et en envois (1/min, 5/h). |
| Énumération des comptes | Inscription et « mot de passe oublié » répondent pareil ; la connexion coûte le même calcul (hash factice). |
| Vol de session | Jeton aléatoire en cookie `HttpOnly; Secure; SameSite=Lax`, seul son SHA-256 en base, 30 jours. |
| CSRF | Toute écriture exige `Origin` = `PUBLIC_URL` (ou `Sec-Fetch-Site: same-origin`). |
| Mots de passe en base | scrypt (N = 2^15, r = 8, p = 1), paramètres dans le hash. |
| Fuite de la clé Interfast | Chiffrée AES-256-GCM (`ENVO_SECRET_KEY`), jamais renvoyée au navigateur (4 derniers caractères seulement). |
| Accès aux données d’un autre compte | Toute requête filtrée par `user_id` ; identifiants vérifiés (UUID). |
| SSRF par l’URL MCP saisie | https seulement, pas d’identifiants dans l’URL, adresses locales et privées refusées. |
| Écriture non voulue dans Interfast (erreur ou injection de consignes via un résultat d’outil) | Tout outil qui MODIFIE Interfast attend le « Valider » de l’artisan ; exécuté par le serveur avec les arguments montrés ; dans le doute, un outil est traité comme une écriture. À la voix, seule une formule explicite valide. |
| Vol ou fuite de la clé vocale (Siri) | Clé propre à la voix (jamais le mot de passe ni la session), montrée une seule fois, seul son SHA-256 en base, révocable dans Paramètres → Siri, 10 par compte, débit limité ; une écriture dans Interfast exige toujours « je valide ». La route `/api/voix` n'accepte QUE la clé (le cookie n'y vaut rien), d'où son exemption du contrôle d'origine. |
| Réponse du modèle qui injecte du HTML | Rendu markdown en éléments React, jamais de HTML injecté. |
| Corps de requête énormes | 1 Mo au plus ; mots de passe ≤ 256 caractères. |

## Risques restants (prototype)

- Rebond DNS : un nom public qui se résout vers une adresse privée n’est pas bloqué (la validation porte sur l’URL, pas sur la résolution). À traiter avant la production (liste blanche des hôtes Interfast, ou résolution vérifiée).
- Les limites de débit sont en mémoire : elles repartent à zéro au redémarrage.
- Pas de liste « mes appareils » ni de passkeys (Pixo les a ; à reprendre).
- Le contenu des séances (ce que l’artisan dit de ses clients) est stocké en base pour reprendre une séance ; il part aussi chez Anthropic pour être traité.
