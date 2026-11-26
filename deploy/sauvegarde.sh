#!/usr/bin/env bash
# Sauvegarde nocturne (envo-sauvegarde.timer) : la base (pg_dump),
# dans /srv/envo/sauvegardes, 7 jours gardés. Chaque archive est VÉRIFIÉE avant
# d'être gardée : une sauvegarde vide est pire qu'aucune, elle rassure.
#
# Puis, si c'est configuré dans envo.env, une copie CHIFFRÉE part HORS du VPS, sur
# un stockage objet compatible S3 (OVH Object Storage, Scaleway, Backblaze…) :
# une panne ou une perte du serveur n'emporte plus les sauvegardes avec les données.
#
#   SAUVEGARDE_S3_URL     ex. https://s3.gra.io.cloud.ovh.net/envo-sauvegardes
#   SAUVEGARDE_S3_REGION  ex. gra
#   SAUVEGARDE_S3_CLE / SAUVEGARDE_S3_SECRET  clés d'accès du stockage
#   SAUVEGARDE_PHRASE     phrase de chiffrement (AES-256, PBKDF2) — gardée AUSSI
#                         hors du VPS : sans elle, la copie est illisible.
#
# Le stockage ne reçoit que du chiffré : même lu par un tiers, il ne dit rien.

main() {
  set -euo pipefail
  local RACINE=${ENVO_RACINE:-/srv/envo}
  local DEST=$RACINE/sauvegardes
  local JOUR
  JOUR=$(date +%Y-%m-%d)
  local TMP=$DEST/.$JOUR.tmp
  rm -rf "$TMP"
  mkdir -p "$TMP"

  pg_dump --no-owner --format=custom --file="$TMP/base.dump" "${PGDATABASE:-envo}"
  pg_restore --list "$TMP/base.dump" | grep -q "TABLE public users" || { echo "dump sans la table users" >&2; exit 1; }


  rm -rf "${DEST:?}/$JOUR"
  mv "$TMP" "$DEST/$JOUR"
  ls -1d "$DEST"/20??-??-?? 2>/dev/null | sort | head -n -7 | while read -r d; do rm -rf "$d"; done
  echo "Sauvegarde $JOUR : $(du -sh "$DEST/$JOUR" | cut -f1)"
  copie_distante "$DEST/$JOUR" "$JOUR"
}

copie_distante() {
  local DOSSIER=$1 JOUR=$2
  if [[ -z ${SAUVEGARDE_S3_URL:-} || -z ${SAUVEGARDE_S3_CLE:-} || -z ${SAUVEGARDE_S3_SECRET:-} || -z ${SAUVEGARDE_PHRASE:-} ]]; then
    echo "⚠️  Copie hors du VPS non configurée (SAUVEGARDE_S3_* et SAUVEGARDE_PHRASE dans envo.env) : la sauvegarde reste sur le serveur." >&2
    return 0
  fi
  local ARCH
  ARCH=$(mktemp "${TMPDIR:-/tmp}/envo-sauvegarde.XXXXXX")
  # Archive du jour, chiffrée ; puis relue et déchiffrée AVANT l'envoi : on n'envoie pas une copie qu'on ne sait pas rouvrir.
  tar -C "$(dirname "$DOSSIER")" -cf - "$(basename "$DOSSIER")" |
    openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:SAUVEGARDE_PHRASE -out "$ARCH"
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:SAUVEGARDE_PHRASE -in "$ARCH" | tar -tf - | grep -q "base.dump" ||
    { rm -f "$ARCH"; echo "copie chiffrée illisible : non envoyée" >&2; return 1; }
  local CIBLE="${SAUVEGARDE_S3_URL%/}/envo-$JOUR.tar.enc"
  local TAILLE
  TAILLE=$(stat -c %s "$ARCH")
  curl -fsS --retry 3 --aws-sigv4 "aws:amz:${SAUVEGARDE_S3_REGION:-us-east-1}:s3" --user "$SAUVEGARDE_S3_CLE:$SAUVEGARDE_S3_SECRET" \
    -H "Content-Type: application/octet-stream" -T "$ARCH" "$CIBLE" >/dev/null
  # Vérifiée là-bas : même taille que ce qui est parti.
  local RECU
  RECU=$(curl -fsSI --aws-sigv4 "aws:amz:${SAUVEGARDE_S3_REGION:-us-east-1}:s3" --user "$SAUVEGARDE_S3_CLE:$SAUVEGARDE_S3_SECRET" "$CIBLE" |
    tr -d '\r' | awk -F': ' 'tolower($1)=="content-length"{print $2}')
  rm -f "$ARCH"
  [[ $RECU == "$TAILLE" ]] || { echo "copie distante incomplète ($RECU sur $TAILLE octets)" >&2; return 1; }
  echo "Copie hors VPS : $CIBLE ($TAILLE octets, chiffrée)"
}

main "$@"
