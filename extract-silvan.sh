#!/usr/bin/env bash
# extract-silvan.sh
#
# Unzips silvan-modular.zip directly into the current directory (run this
# from your repo root in a GitHub Codespace / online codebase terminal).
# The zip has no wrapping folder — index.html, main.js, core/, environment/,
# etc. sit at the top level of the zip, so they land straight into your repo
# root instead of nesting inside an extra silvan/ subfolder.
#
# Usage:
#   1. Upload both silvan-modular.zip and this script into the Codespace
#      (drag-and-drop into the file explorer, or the Codespaces upload
#      button works for both).
#   2. In the Codespace terminal, from your repo root:
#        chmod +x extract-silvan.sh
#        ./extract-silvan.sh
#
# Optional: pass a different zip path/name as the first argument, e.g.
#   ./extract-silvan.sh path/to/other.zip
#
# Optional: pass -f as an argument to overwrite existing files without
# prompting (useful when re-running after a newer zip), e.g.
#   ./extract-silvan.sh silvan-modular.zip -f
#
# Optional: pass -d <folder> to extract into a subfolder instead of the
# current directory, e.g.
#   ./extract-silvan.sh silvan-modular.zip -d silvan

set -euo pipefail

ZIP_NAME="silvan-modular.zip"
FORCE_FLAG=""
DEST_DIR="."

while [ $# -gt 0 ]; do
    case "$1" in
        -f) FORCE_FLAG="-o" ;;
        -d) shift; DEST_DIR="${1:-.}" ;;
        *) ZIP_NAME="$1" ;;
    esac
    shift
done

if [ ! -f "$ZIP_NAME" ]; then
    echo "Error: couldn't find '$ZIP_NAME' in the current directory ($(pwd))." >&2
    echo "Upload it here first, or pass its path as an argument:" >&2
    echo "  ./extract-silvan.sh path/to/silvan-modular.zip" >&2
    exit 1
fi

if ! command -v unzip >/dev/null 2>&1; then
    echo "Error: 'unzip' isn't available in this environment." >&2
    echo "On Debian/Ubuntu-based Codespaces you can install it with:" >&2
    echo "  sudo apt-get update && sudo apt-get install -y unzip" >&2
    exit 1
fi

mkdir -p "$DEST_DIR"
echo "Extracting '$ZIP_NAME' into $(cd "$DEST_DIR" && pwd) ..."
unzip $FORCE_FLAG "$ZIP_NAME" -d "$DEST_DIR"

echo ""
echo "Done. Top-level contents:"
find "$DEST_DIR" -maxdepth 1 -mindepth 1 | sort

echo ""
echo "Next steps:"
echo "  git add ."
echo "  git commit -m \"Add modularized Silvan codebase\""
echo "  git push"
