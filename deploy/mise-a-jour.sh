#!/usr/bin/env bash
# Lancé chaque minute par envo-deploiement.timer, sous l'utilisateur envo.
#
# Compare la branche dist (site + serveur compilés par la CI) à ce qui est en
# ligne ; si elle a avancé, copie la nouvelle version dans releases/<commit>,
# bascule le lien `current`, redémarre l'API, et vérifie à l'adresse PUBLIQUE que
# le site ET l'API servent ce commit. Sinon : retour à la version précédente.
#
# Tout le corps est dans main() : bash lit un script au fil de l'exécution, et ce
# fichier est remplacé par sa nouvelle version pendant le déploiement. Une fonction
# est lue en entier avant d'être exécutée.

main() {
  set -euo pipefail
  # ENVO_RACINE et ENVO_REDEMARRER ne servent qu'aux essais hors serveur.
  local RACINE=${ENVO_RACINE:-/srv/envo}
  local REDEMARRER=${ENVO_REDEMARRER:-sudo -n /usr/bin/systemctl restart envo-api.service}
  local DEPOT=$RACINE/depot
  local MARQUEUR=$RACINE/.commit-deploye
  local ECHEC=$RACINE/.commit-en-echec
  local URL=${PUBLIC_URL:-http://localhost}
  URL=${URL%/}
  local GARDER=5

  exec 9>"$RACINE/.deploiement.lock"
  flock -n 9 || exit 0

  git -C "$DEPOT" fetch -q --depth 1 origin dist
  git -C "$DEPOT" checkout -q -f --detach FETCH_HEAD
  local commit
  commit=$(tr -dc '0-9a-f' < "$DEPOT/COMMIT")
  [[ ${#commit} -eq 40 ]] || { echo "COMMIT illisible dans la branche dist" >&2; exit 1; }

  # Déjà en ligne, ou déjà essayé sans succès : rien à faire jusqu'au commit suivant.
  [[ -f $MARQUEUR && $(cat "$MARQUEUR") == "$commit" ]] && exit 0
  [[ -f $ECHEC && $(cat "$ECHEC") == "$commit" ]] && exit 0
  if [[ ! -f $DEPOT/www/index.html || ! -f $DEPOT/server/server.mjs ]]; then
    echo "branche dist incomplète (www/index.html ou server/server.mjs absent)" >&2
    echo "$commit" > "$ECHEC"
    exit 1
  fi

  echo "Déploiement de $commit"
  local version=$RACINE/releases/$commit
  rm -rf "$version.tmp"
  mkdir -p "$version.tmp"
  cp -a "$DEPOT/www" "$version.tmp/www"
  cp -a "$DEPOT/server/server.mjs" "$version.tmp/server.mjs"
  echo "$commit" > "$version.tmp/COMMIT"
  rm -rf "$version"
  mv "$version.tmp" "$version"

  local precedente=""
  [[ -L $RACINE/current ]] && precedente=$(readlink -f "$RACINE/current")
  basculer "$RACINE" "$version"
  $REDEMARRER || true

  local hote=${URL#*://}
  hote=${hote%%/*}
  if ! controle "$URL" "$commit"; then
    # L'adresse publique ne répond pas. Si le VPS lui-même sert la bonne version
    # (nginx en local, même nom d'hôte), c'est le DNS, TLS ou le réseau qui manque
    # — pas la version : on la garde. Sinon on l'écarterait pour toujours, et le
    # site ne se débloquerait pas une fois le DNS créé (vécu à l'installation).
    if controle "${ENVO_LOCAL:-http://127.0.0.1}" "$commit" "$hote"; then
      echo "⚠️  $commit fonctionne sur le VPS, mais $URL est injoignable (DNS ? HTTPS ?). Version gardée." >&2
    else
      echo "Le site ne sert pas $commit — retour à la version précédente." >&2
      if [[ -n $precedente && -d $precedente ]]; then
        basculer "$RACINE" "$precedente"
        $REDEMARRER || true
      fi
      echo "$commit" > "$ECHEC"
      exit 1
    fi
  fi

  # Le script et la sauvegarde se mettent à jour (remplacement atomique : la
  # version en cours d'exécution est déjà en mémoire, cf. main()).
  for s in mise-a-jour.sh sauvegarde.sh; do
    install -m 0755 "$DEPOT/deploy/$s" "$RACINE/bin/$s.nouveau"
    mv -f "$RACINE/bin/$s.nouveau" "$RACINE/bin/$s"
  done

  echo "$commit" > "$MARQUEUR"
  rm -f "$ECHEC"

  # Purge : on garde les GARDER versions les plus récentes, jamais celle en ligne.
  local actuelle
  actuelle=$(readlink -f "$RACINE/current")
  ls -1dt "$RACINE"/releases/*/ 2>/dev/null | tail -n +$((GARDER + 1)) | while read -r d; do
    [[ $(readlink -f "$d") == "$actuelle" ]] || rm -rf "$d"
  done
  echo "En ligne : $commit"
}

basculer() {
  ln -sfn "$2" "$1/current.tmp"
  mv -T "$1/current.tmp" "$1/current"
}

# Le site (balise envo-commit) ET l'API ("db":true et le commit) doivent répondre.
# Contrôle par l'adresse publique : un test sur 127.0.0.1 validerait un site que le
# DNS, nginx ou TLS empêchent d'atteindre. -L suit la redirection HTTPS de certbot.
# L'API met quelques secondes à démarrer : jusqu'à 10 essais.
controle() {
  local URL=$1 commit=$2 i
  local h=()
  [[ -n ${3:-} ]] && h=(-H "Host: $3")
  for i in 1 2 3 4 5 6 7 8 9 10; do
    if curl -fsSL --max-time 10 "${h[@]}" -H 'Cache-Control: no-cache' "$URL/" | grep -q "content=\"$commit\"" &&
      curl -fsSL --max-time 10 "${h[@]}" "$URL/api/health" | grep -q "\"db\":true,\"commit\":\"$commit\""; then
      return 0
    fi
    sleep 2
  done
  return 1
}

main "$@"
