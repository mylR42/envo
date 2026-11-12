#!/usr/bin/env bash
# Installation (et réinstallation) de Envo sur le VPS. Idempotent : se relance sans risque.
#
#   sudo DOMAINE=envo.mondomaine.fr bash deploy/install-vps.sh
#
# Variables :
#   DOMAINE  (obligatoire) sous-domaine servi, son DNS doit déjà pointer sur le VPS
#   DEPOT    (facultatif)  URL du dépôt ; un dépôt PRIVÉ demande une URL SSH et une
#                          clé de déploiement en lecture seule (voir DEPLOY.md)
#
# Le VPS est PARTAGÉ (bluetti, Ludix, Pixo) : ce script ne touche qu'à ce qui porte le nom
# envo, valide nginx avant de recharger et remet l'ancienne configuration si elle
# est refusée. Node est installé DANS /srv/envo/node, pas dans le système : un
# Node système mis à jour pour Envo pourrait casser un voisin qui en dépend.

NODE_VERSION=22.23.4

main() {
  set -euo pipefail
  [[ $EUID -eq 0 ]] || { echo "À lancer avec sudo." >&2; exit 1; }
  local DOMAINE=${DOMAINE:?DOMAINE manquant, ex. DOMAINE=envo.mondomaine.fr}
  # Sans DEPOT explicite, un dépôt déjà cloné GARDE son adresse : la remplacer par
  # l'URL https par défaut cassait le déploiement d'un dépôt privé (clé SSH), vécu
  # le 05/11/2026 (« could not read Username for 'https://github.com' »).
  local DEPOT_DONNE=${DEPOT:-}
  local DEPOT=${DEPOT:-https://github.com/mylR42/envo.git}
  local RACINE=/srv/envo
  local UTIL=envo
  local PORT=3880

  # --- Paquets : seulement s'il en manque, sous le verrou apt partagé du VPS.
  local manquants=()
  for p in nginx git curl postgresql xz-utils openssl; do dpkg -s "$p" >/dev/null 2>&1 || manquants+=("$p"); done
  if ((${#manquants[@]})); then
    echo "Installation : ${manquants[*]}"
    flock /var/lock/vps-apt.lock -c "apt-get update -q && DEBIAN_FRONTEND=noninteractive apt-get install -y -q ${manquants[*]}"
  fi

  # --- Utilisateur et arborescence.
  id -u "$UTIL" >/dev/null 2>&1 || useradd --system --home-dir "$RACINE" --shell /usr/sbin/nologin "$UTIL"
  install -d -o "$UTIL" -g "$UTIL" -m 0755 "$RACINE" "$RACINE/releases" "$RACINE/bin"
  install -d -o "$UTIL" -g "$UTIL" -m 0700 "$RACINE/sauvegardes"

  # --- Node, privé à Envo, vérifié par sa somme SHA-256 officielle.
  installer_node "$RACINE"

  # --- PostgreSQL : rôle et base `envo`, authentification « peer » par socket
  # Unix (l'utilisateur système envo EST le rôle envo) : aucun mot de passe à garder.
  if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='$UTIL'" | grep -q 1; then
    sudo -u postgres createuser "$UTIL"
  fi
  if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='$UTIL'" | grep -q 1; then
    sudo -u postgres createdb -O "$UTIL" "$UTIL"
  fi

  # --- Clone de la branche dist (le site et le serveur compilés par la CI).
  if [[ ! -d $RACINE/depot/.git ]]; then
    sudo -u "$UTIL" git clone -q --depth 1 --branch dist "$DEPOT" "$RACINE/depot" || {
      echo "Clone impossible. La branche dist existe-t-elle ? Elle naît au premier push sur main (CI)." >&2
      exit 1
    }
  elif [[ -n $DEPOT_DONNE ]]; then
    sudo -u "$UTIL" git -C "$RACINE/depot" remote set-url origin "$DEPOT"
  fi

  ecrire_configuration "$RACINE/envo.env" "$DOMAINE" "$PORT" "$RACINE"
  chown "$UTIL:$UTIL" "$RACINE/envo.env"
  chmod 0600 "$RACINE/envo.env"
  install -o "$UTIL" -g "$UTIL" -m 0755 "$RACINE/depot/deploy/mise-a-jour.sh" "$RACINE/bin/mise-a-jour.sh"
  install -o "$UTIL" -g "$UTIL" -m 0755 "$RACINE/depot/deploy/sauvegarde.sh" "$RACINE/bin/sauvegarde.sh"

  # --- Le déploiement (utilisateur envo) redémarre l'API, et rien d'autre.
  local SUDOERS=/etc/sudoers.d/envo
  printf '%s ALL=(root) NOPASSWD: /usr/bin/systemctl restart envo-api.service\n' "$UTIL" > "$SUDOERS.tmp"
  chmod 0440 "$SUDOERS.tmp"
  if visudo -cf "$SUDOERS.tmp" >/dev/null; then mv "$SUDOERS.tmp" "$SUDOERS"; else rm -f "$SUDOERS.tmp"; echo "règle sudo refusée" >&2; exit 1; fi

  configurer_nginx "$RACINE" "$DOMAINE" "$PORT"
  configurer_systemd "$RACINE" "$UTIL"

  # Premier déploiement tout de suite, sans attendre le minuteur.
  systemctl start envo-deploiement.service || {
    echo "Premier déploiement en échec : journalctl -u envo-deploiement -n 50" >&2
    exit 1
  }
  echo "Envo est en ligne sur http://$DOMAINE/"
  echo "HTTPS : sudo certbot --nginx -d $DOMAINE   (puis passer PUBLIC_URL en https:// dans $RACINE/envo.env)"
  echo "Clé Anthropic (obligatoire pour l'assistante) et Mailjet : compléter $RACINE/envo.env puis sudo systemctl restart envo-api (voir DEPLOY.md)."
}

installer_node() {
  local RACINE=$1
  if [[ -x $RACINE/node/bin/node && $("$RACINE/node/bin/node" -v) == "v$NODE_VERSION" ]]; then return; fi
  local arch
  case $(uname -m) in x86_64) arch=x64 ;; aarch64) arch=arm64 ;; *) echo "architecture non prise en charge : $(uname -m)" >&2; exit 1 ;; esac
  local nom="node-v$NODE_VERSION-linux-$arch"
  local tmp
  tmp=$(mktemp -d)
  echo "Installation de Node $NODE_VERSION dans $RACINE/node"
  curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/$nom.tar.xz" -o "$tmp/$nom.tar.xz"
  curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt"
  (cd "$tmp" && grep " $nom.tar.xz\$" SHASUMS256.txt | sha256sum -c --quiet) || { echo "somme SHA-256 de Node invalide" >&2; exit 1; }
  tar -xJf "$tmp/$nom.tar.xz" -C "$tmp"
  rm -rf "$RACINE/node.nouveau"
  mv "$tmp/$nom" "$RACINE/node.nouveau"
  rm -rf "$RACINE/node"
  mv "$RACINE/node.nouveau" "$RACINE/node"
  rm -rf "$tmp"
}

# Écrit envo.env en CONSERVANT toute valeur déjà présente : ce fichier porte les
# secrets (clé de chiffrement, Anthropic, Mailjet). ENVO_SECRET_KEY n'est tirée
# qu'à la PREMIÈRE installation : la changer rendrait illisibles les clés Interfast. Le
# réécrire sans le relire les effacerait à chaque déploiement.
ecrire_configuration() {
  local FICHIER=$1 DOMAINE=$2 PORT=$3 RACINE=$4
  declare -A valeur=()
  if [[ -f $FICHIER ]]; then
    while IFS='=' read -r cle reste; do
      [[ $cle =~ ^[A-Z_]+$ ]] && valeur[$cle]=$reste
    done < "$FICHIER"
  fi
  local defaut
  {
    echo "# Configuration de Envo — relue et CONSERVÉE par deploy/install-vps.sh."
    echo "# Après modification : sudo systemctl restart envo-api"
    for ligne in \
      "PUBLIC_URL=http://$DOMAINE" "PORT=$PORT" \
      "ENVO_SECRET_KEY=$(openssl rand -base64 33 | tr -d '\n')" \
      "ANTHROPIC_API_KEY=" "ANTHROPIC_MODEL=claude-opus-5-5" "ANTHROPIC_EFFORT=medium" \
      "PGHOST=/var/run/postgresql" "PGDATABASE=envo" "PGUSER=envo" \
      "MAILJET_API_KEY=" "MAILJET_SECRET_KEY=" "MAIL_FROM=" "MAIL_FROM_NAME=Envo" \
      "SAUVEGARDE_S3_URL=" "SAUVEGARDE_S3_REGION=" "SAUVEGARDE_S3_CLE=" "SAUVEGARDE_S3_SECRET=" "SAUVEGARDE_PHRASE="; do
      local cle=${ligne%%=*}
      defaut=${ligne#*=}
      echo "$cle=${valeur[$cle]-$defaut}"
      unset "valeur[$cle]"
    done
    # Clés ajoutées à la main, inconnues de ce script : gardées telles quelles.
    for cle in "${!valeur[@]}"; do echo "$cle=${valeur[$cle]}"; done
  } > "$FICHIER.tmp"
  mv "$FICHIER.tmp" "$FICHIER"
}

configurer_nginx() {
  local RACINE=$1 DOMAINE=$2 PORT=$3
  local SNIPPETS=(envo-app.conf envo-entetes.conf)
  local VHOST=/etc/nginx/sites-available/envo
  local SAUV
  SAUV=$(mktemp -d)
  for s in "${SNIPPETS[@]}"; do
    [[ -f /etc/nginx/snippets/$s ]] && cp "/etc/nginx/snippets/$s" "$SAUV/$s"
  done
  sed "s#@RACINE@#$RACINE#g; s#@PORT@#$PORT#g" "$RACINE/depot/deploy/nginx-envo-app.conf" > /etc/nginx/snippets/envo-app.conf
  cp "$RACINE/depot/deploy/nginx-envo-entetes.conf" /etc/nginx/snippets/envo-entetes.conf
  # Le vhost n'est écrit qu'UNE fois : ensuite il appartient à certbot (HTTPS).
  local vhost_neuf=0
  if [[ ! -f $VHOST ]]; then
    vhost_neuf=1
    cat > "$VHOST" <<VHOST
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAINE;
    include snippets/envo-app.conf;
}
VHOST
    ln -sfn "$VHOST" /etc/nginx/sites-enabled/envo
  fi
  if ! nginx -t 2>/tmp/envo-nginx-t.log; then
    echo "nginx refuse la configuration — retour à l'état précédent :" >&2
    cat /tmp/envo-nginx-t.log >&2
    for s in "${SNIPPETS[@]}"; do
      if [[ -f $SAUV/$s ]]; then cp "$SAUV/$s" "/etc/nginx/snippets/$s"; else rm -f "/etc/nginx/snippets/$s"; fi
    done
    if ((vhost_neuf)); then rm -f "$VHOST" /etc/nginx/sites-enabled/envo; fi
    exit 1
  fi
  rm -rf "$SAUV"
  systemctl reload nginx
}

configurer_systemd() {
  local RACINE=$1 UTIL=$2
  # L'API : bridée en mémoire et en droits, pour qu'un défaut de Envo ne puisse
  # ni affamer ni toucher les voisins du VPS.
  cat > /etc/systemd/system/envo-api.service <<UNIT
[Unit]
Description=Envo : API (comptes, assistante, Interfast)
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
User=$UTIL
EnvironmentFile=$RACINE/envo.env
Environment=NODE_ENV=production
ExecStart=$RACINE/node/bin/node $RACINE/current/server.mjs
Restart=on-failure
RestartSec=3
MemoryMax=400M
CPUQuota=80%
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT
  cat > /etc/systemd/system/envo-deploiement.service <<UNIT
[Unit]
Description=Envo : déploie la dernière version compilée (branche dist)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=$UTIL
EnvironmentFile=$RACINE/envo.env
ExecStart=$RACINE/bin/mise-a-jour.sh
UNIT
  cat > /etc/systemd/system/envo-deploiement.timer <<UNIT
[Unit]
Description=Envo : surveille la branche dist

[Timer]
OnBootSec=2min
OnUnitActiveSec=1min
RandomizedDelaySec=20s

[Install]
WantedBy=timers.target
UNIT
  cat > /etc/systemd/system/envo-sauvegarde.service <<UNIT
[Unit]
Description=Envo : sauvegarde nocturne (base)

[Service]
Type=oneshot
User=$UTIL
EnvironmentFile=$RACINE/envo.env
ExecStart=$RACINE/bin/sauvegarde.sh
Nice=10
IOSchedulingClass=idle
UNIT
  cat > /etc/systemd/system/envo-sauvegarde.timer <<UNIT
[Unit]
Description=Envo : sauvegarde chaque nuit

[Timer]
OnCalendar=*-*-* 03:20
RandomizedDelaySec=30min
Persistent=true

[Install]
WantedBy=timers.target
UNIT
  systemctl daemon-reload
  systemctl enable envo-api.service >/dev/null
  systemctl enable --now envo-deploiement.timer envo-sauvegarde.timer >/dev/null
}

main "$@"
