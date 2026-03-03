#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

build_plugin() {
    local PLUGIN_ID="$1"
    local PLUGIN_NAME="$2"
    local PLUGIN_DESC="$3"
    local PLUGIN_FILES=("${@:4}")
    local PLUGIN_DIR="${SCRIPT_DIR}/${PLUGIN_ID}"

    echo "── Building ${PLUGIN_NAME} ──"

    local VERSION
    VERSION=$(awk '/^version:/ { print $2; exit }' "${PLUGIN_DIR}/${PLUGIN_ID}.yml")
    if [[ -z "$VERSION" ]]; then
        echo "Error: could not read version from ${PLUGIN_ID}/${PLUGIN_ID}.yml" >&2
        exit 1
    fi

    rm -f "${PLUGIN_DIR}/${PLUGIN_ID}.zip"
    rm -rf "${PLUGIN_DIR}/_build"
    mkdir -p "${PLUGIN_DIR}/_build/${PLUGIN_ID}"

    for f in "${PLUGIN_FILES[@]}"; do
        cp "${PLUGIN_DIR}/$f" "${PLUGIN_DIR}/_build/${PLUGIN_ID}/"
    done
    (cd "${PLUGIN_DIR}/_build" && zip -r "../${PLUGIN_ID}.zip" "${PLUGIN_ID}/")
    rm -rf "${PLUGIN_DIR}/_build"

    local SHA
    if command -v sha256sum &>/dev/null; then
        SHA=$(sha256sum "${PLUGIN_DIR}/${PLUGIN_ID}.zip" | awk '{print $1}')
    else
        SHA=$(shasum -a 256 "${PLUGIN_DIR}/${PLUGIN_ID}.zip" | awk '{print $1}')
    fi

    local DATE
    DATE=$(date +"%Y-%m-%d %H:%M:%S")

    # Update this plugin's entry in the root index.yml
    local INDEX="${SCRIPT_DIR}/index.yml"
    touch "$INDEX"
    python3 - "$INDEX" "$PLUGIN_ID" <<'PYEOF'
import re, sys
path, plugin_id = sys.argv[1], sys.argv[2]
content = open(path).read()
content = re.sub(r'- id: ' + re.escape(plugin_id) + r'\n(?:  [^\n]*\n)*', '', content)
open(path, 'w').write(content)
PYEOF
    cat >> "$INDEX" <<EOF
- id: ${PLUGIN_ID}
  name: ${PLUGIN_NAME}
  version: ${VERSION}
  date: "${DATE}"
  path: ${PLUGIN_ID}/${PLUGIN_ID}.zip
  sha256: ${SHA}
  metadata:
    description: ${PLUGIN_DESC}
EOF

    echo "  version: ${VERSION}  sha256: ${SHA}"
}

build_stash_sync() {
    build_plugin "stash-sync" \
        "Stash Sync" \
        "Transfer scenes between two Stash instances with full metadata preservation" \
        stash-sync.yml stash-sync.py stash_sync_ui.js requirements.txt
}

build_stash_scrape() {
    build_plugin "stash-scrape" \
        "Stash Scrape" \
        "Scrape scene metadata in the background as a task, with configurable attribute creation" \
        stash-scrape.yml stash-scrape.py stash_scrape_ui.js requirements.txt
}

# ── Main ──
TARGET="${1:-all}"

case "$TARGET" in
    all)
        build_stash_sync
        build_stash_scrape
        ;;
    stash-sync)
        build_stash_sync
        ;;
    stash-scrape)
        build_stash_scrape
        ;;
    *)
        echo "Error: unknown plugin '${TARGET}'" >&2
        echo "Usage: $0 [all|stash-sync|stash-scrape]" >&2
        exit 1
        ;;
esac

echo ""
echo "Next steps:"
echo "  1. Commit and push:  git add -A && git commit -m 'build plugin packages' && git push"
echo "  2. In Stash, go to Settings > Plugins > Available Plugins > Add Source"
echo "  3. Use the source URL below"
echo ""

REMOTE_URL=$(git -C "$SCRIPT_DIR" remote get-url origin 2>/dev/null || echo "")
if [[ -n "$REMOTE_URL" ]]; then
    REPO_PATH="${REMOTE_URL#git@github.com:}"
    REPO_PATH="${REPO_PATH#https://github.com/}"
    REPO_PATH="${REPO_PATH%.git}"
    BRANCH=$(git -C "$SCRIPT_DIR" branch --show-current 2>/dev/null || echo "main")
    echo "  Source URL:  https://raw.githubusercontent.com/${REPO_PATH}/${BRANCH}/index.yml"
else
    echo "  Source URL:  https://raw.githubusercontent.com/<you>/stash-plugins/<branch>/index.yml"
fi
echo ""
