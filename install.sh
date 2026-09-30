#!/bin/bash
# Symlink this repo's plugin bundle into Sketch so edits go live immediately.
set -e
REPO="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/Library/Application Support/com.bohemiancoding.sketch3/Plugins/CiticsAllCaps.sketchplugin"
if [ -e "$DEST" ] && [ ! -L "$DEST" ]; then
  mv "$DEST" "$DEST.backup-$(date +%Y%m%d%H%M%S)"
  echo "Existing plugin moved aside as a backup."
fi
rm -f "$DEST"
ln -s "$REPO/CiticsAllCaps.sketchplugin" "$DEST"
echo "Linked: $DEST -> $REPO/CiticsAllCaps.sketchplugin"
echo "Restart Sketch to pick up the menu."
