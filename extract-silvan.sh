#!/usr/bin/env bash
# extract-silvan.sh
#
# Unzips silvan-modular.zip into the current directory (run this from your
# repo root in a GitHub Codespace / online codebase terminal). The zip
# contains one top-level folder, silvan/, so after extraction you'll have
# ./silvan/... sitting alongside your existing repo files.
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
# Optional: pass -f as the last argument to overwrite existing files
# without prompting, e.g.
#   ./extract-silvan.sh silvan-modular.zip -f

set -euo pipefail

ZIP_NAME="${1:-silvan-modular.zip}"
FORCE_FLAG=""
if [ "${2:-}" = "-f" ] || [ "${1:-}" = "-f" ]; then
    FORCE_FLAG="-o"
fi

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

echo "Extracting '$ZIP_NAME' into $(pwd) ..."
unzip $FORCE_FLAG "$ZIP_NAME"

echo ""
echo "Done. Contents:"
find silvan -maxdepth 2 | sort

echo ""
echo "Next steps:"
echo "  git add silvan"
echo "  git commit -m \"Add modularized Silvan codebase\""
echo "  git push"
