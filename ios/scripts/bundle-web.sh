#!/bin/sh
# Copies the web app (the files one level up) into the app bundle as "www". The web files stay the single source of truth.
set -e
SRC="$SRCROOT/.."
DEST="$TARGET_BUILD_DIR/$CONTENTS_FOLDER_PATH/www"
rm -rf "$DEST"; mkdir -p "$DEST"
for f in index.html instruments.js tones.js cloud.js firebase-config.js manifest.webmanifest; do cp "$SRC/$f" "$DEST/"; done
for d in samples sounds previews icons; do rsync -a --exclude CREDITS.md --exclude .DS_Store "$SRC/$d" "$DEST/"; done
