# Déploiement sur le VPS

Envo = un **site statique** (React) + une **API Node** (comptes, assistante,
connexion à Interfast) + **PostgreSQL**. nginx sert le site et transmet `/api/` à
l'API, qui n'écoute que sur `127.0.0.1:3880`. Même modèle que Pixo, sur le même
VPS OVHcloud (partagé avec bluetti, Ludix et Pixo).

```
merge sur main ──► GitHub Actions : tests (dont un vrai PostgreSQL) + compilation
                     └─► branche `dist` : www/ + server/server.mjs (API, un seul fichier) + deploy/ + COMMIT
VPS : envo-deploiement.timer (chaque minute) ◄── git fetch ─┘
      └─ deploy/mise-a-jour.sh : releases/<commit> → lien current → redémarre l'API
                                 → contrôle PUBLIC du site ET de /api/health → ou retour arrière
```

Le VPS **tire**, GitHub ne pousse pas : aucun secret du serveur n'est chez
GitHub. **Rien n'est compilé sur le VPS.**

## Installation (une fois, ~10 minutes)

Adresse proposée : **https://envo.creatvaltec.fr/** (remplacer partout si autre).

**0. La branche `dist` doit exister** : elle naît au premier passage de la CI sur
`main` (onglet *Actions* du dépôt, tâche « Vérification » au vert).

**1. DNS** — espace client OVH, zone `creatvaltec.fr` : un enregistrement **A**
`envo` → l'adresse IPv4 du VPS (la même que `pixo`). Vérifier :
`dig +short envo.creatvaltec.fr`.

**2. Clé de déploiement** (le dépôt est privé) — sur le VPS :

```bash
sudo useradd --system --home-dir /srv/envo --create-home --shell /usr/sbin/nologin envo
sudo -u envo mkdir -p -m 700 /srv/envo/.ssh
sudo -u envo ssh-keygen -t ed25519 -N '' -C envo-vps -f /srv/envo/.ssh/id_ed25519
sudo cat /srv/envo/.ssh/id_ed25519.pub
```

Copier la ligne affichée dans GitHub → dépôt **envo** → *Settings* → *Deploy
keys* → *Add deploy key* (titre « VPS », **sans** *Allow write access*).

**3. Installation** :

```bash
sudo -u envo env GIT_SSH_COMMAND='ssh -o StrictHostKeyChecking=accept-new' \
  git clone --depth 1 --branch dist git@github.com:mylR42/envo.git /srv/envo/depot
sudo DOMAINE=envo.creatvaltec.fr DEPOT=git@github.com:mylR42/envo.git \
  bash /srv/envo/depot/deploy/install-vps.sh
```

Il termine par « Envo est en ligne sur http://envo.creatvaltec.fr/ ». S'il
échoue au contrôle final, c'est presque toujours le DNS : attendre, relancer.

**4. HTTPS** (obligatoire : sans lui, ni le micro ni le cookie sécurisé) :

```bash
sudo certbot --nginx -d envo.creatvaltec.fr
sudo sed -i 's#^PUBLIC_URL=http://#PUBLIC_URL=https://#' /srv/envo/envo.env
sudo systemctl restart envo-api
```

**5. Clés** — `sudo nano /srv/envo/envo.env`, puis `sudo systemctl restart envo-api` :

| Clé | Rôle |
|---|---|
| `ANTHROPIC_API_KEY` | **obligatoire** pour l'assistante (console.anthropic.com → API Keys). Sans elle, l'app marche mais AssistDevis est désactivé. |
| `ANTHROPIC_MODEL`, `ANTHROPIC_EFFORT` | `claude-opus-5-5`, `medium` par défaut |
| `MAILJET_*`, `MAIL_FROM` | codes de connexion par e-mail (mêmes clés que Pixo possible, domaine d'envoi validé SPF + DKIM) |
| `ENVO_SECRET_KEY` | **tirée au hasard à l'installation. NE JAMAIS LA CHANGER** : elle déchiffre les clés Interfast enregistrées. La noter hors du VPS. |

Vérifier : `sudo journalctl -u envo-api -n 5` doit dire
« assistante : claude-opus-5-5 » et « e-mail : oui ».

⚠️ **Sans Mailjet, personne ne reçoit de code** (inscription et chaque
connexion). Le code est alors écrit dans le journal :

```bash
sudo journalctl -u envo-api -n 20 --no-pager | grep "code pour"
```

**6. Interfast** — dans l'app : Paramètres → Connexion à Interfast, coller l'URL
du serveur MCP (Interfast → profil → Clés API → lien affiché sous la clé), puis
« Tester la connexion » : la liste des outils doit s'afficher.

Le script est **idempotent** : le relancer remet la configuration d'aplomb et
**conserve** tout `envo.env` (secrets compris, clés inconnues comprises).

### Ce qu'il installe

| Élément | Emplacement |
|---|---|
| utilisateur système | `envo` (sans shell) |
| Node 22 | `/srv/envo/node` (privé, somme SHA-256 vérifiée) |
| PostgreSQL | rôle et base `envo`, socket Unix, authentification « peer », sans mot de passe |
| code | `/srv/envo/depot` (clone de `dist`), `/srv/envo/releases/<commit>`, lien `/srv/envo/current` |
| configuration | `/srv/envo/envo.env` (0600) |
| nginx | `sites-available/envo` (écrit une fois, ensuite à certbot), `snippets/envo-app.conf`, `snippets/envo-entetes.conf` |
| systemd | `envo-api.service` (400 Mo, 80 % d'un cœur, système en lecture seule), `envo-deploiement.timer`, `envo-sauvegarde.timer` |
| sudo | l'utilisateur `envo` peut **seulement** `systemctl restart envo-api.service` |

⚠️ **VPS partagé** : nginx validé (`nginx -t`) avant chaque rechargement, ancienne
configuration remise s'il refuse ; `apt` sous le verrou commun
`/var/lock/vps-apt.lock` ; minuteurs décalés ; rien d'autre que ce qui porte le
nom `envo` n'est modifié.

Deux réglages nginx propres à Envo : la route d'un tour de l'assistante
(`/api/conversations/…/turn`) n'est **pas mise en tampon** et attend 10 minutes
(réponse en flux, plusieurs appels à Claude et à Interfast) ; et
`Permissions-Policy` autorise le **micro** pour le site lui-même (dictée).

## Sauvegardes

`envo-sauvegarde.timer`, chaque nuit vers 3 h 20 : `pg_dump` vérifié dans
`/srv/envo/sauvegardes/AAAA-MM-JJ/`, 7 jours. Copie chiffrée hors du VPS si
`SAUVEGARDE_S3_*` et `SAUVEGARDE_PHRASE` sont remplis (même procédure que Pixo,
voir son `DEPLOY.md`). Restaurer : `sudo systemctl stop envo-api` puis
`sudo -u envo pg_restore --clean --if-exists -d envo /srv/envo/sauvegardes/<jour>/base.dump`.

## Diagnostic

```bash
systemctl status envo-api
journalctl -u envo-api -n 50                 # au démarrage : e-mail oui/non, assistante
journalctl -u envo-deploiement -n 50         # derniers déploiements
cat /srv/envo/.commit-deploye                # commit en ligne
cat /srv/envo/.commit-en-echec 2>/dev/null   # commit refusé par le contrôle public
curl -s https://envo.creatvaltec.fr/api/health
```

Un commit en échec n'est pas réessayé : il faut un nouveau commit sur `main` (ou
supprimer `.commit-en-echec`). Revenir en arrière à la main :
`sudo -u envo ln -sfn /srv/envo/releases/<commit> /srv/envo/current && sudo systemctl restart envo-api`.
