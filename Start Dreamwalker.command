#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEFAULT_WORKSPACE="$(cd "$SCRIPT_DIR/.." && pwd)/dreamwalker-book"
WORKSPACE="${1:-$DEFAULT_WORKSPACE}"

if ! command -v python3 >/dev/null 2>&1; then
  osascript -e 'display dialog "Dreamwalker needs Python 3 on this Mac." buttons {"OK"} default button "OK" with icon caution'
  exit 1
fi

if [ ! -d "$WORKSPACE" ]; then
  osascript -e 'display dialog "Dreamwalker could not find the book workspace. Expected: '"$WORKSPACE"'" buttons {"OK"} default button "OK" with icon caution'
  exit 1
fi

mkdir -p "$WORKSPACE/.dreamwalker/media"

# One-time migration from the original combined book/app layout.
OLD_DATA="$WORKSPACE/visual-app/data/board-data.json"
NEW_DATA="$WORKSPACE/.dreamwalker/board-data.json"
OLD_MEDIA="$WORKSPACE/visual-app/assets/uploads"

if [ ! -f "$NEW_DATA" ] && [ -f "$OLD_DATA" ]; then
  cp "$OLD_DATA" "$NEW_DATA"
  echo "Migrated board data into $WORKSPACE/.dreamwalker/"
fi

if [ -d "$OLD_MEDIA" ] && [ -z "$(ls -A "$WORKSPACE/.dreamwalker/media" 2>/dev/null)" ]; then
  cp -R "$OLD_MEDIA/." "$WORKSPACE/.dreamwalker/media/" 2>/dev/null || true
  echo "Migrated local board images into $WORKSPACE/.dreamwalker/media/"
fi

# Convert old stored image paths to the new workspace-media route when needed.
if [ -f "$NEW_DATA" ]; then
  python3 - "$NEW_DATA" <<'PY'
import json, sys
from pathlib import Path
p=Path(sys.argv[1])
try:
    data=json.loads(p.read_text("utf-8"))
except Exception:
    raise SystemExit(0)
changed=False
for items in (data.get("items") or {}).values():
    for item in items or []:
        path=item.get("imagePath")
        if isinstance(path,str) and path.startswith("assets/uploads/"):
            item["imagePath"]="/workspace-media/"+path.split("/")[-1]
            changed=True
if changed:
    p.write_text(json.dumps(data,indent=2,ensure_ascii=False)+"\n","utf-8")
PY
fi

PORT="$(python3 - <<'PY'
import socket
s=socket.socket()
s.bind(("127.0.0.1",0))
print(s.getsockname()[1])
s.close()
PY
)"

echo
echo "✨ Starting Dreamwalker"
echo "Workspace: $WORKSPACE"
echo "Private local address: http://127.0.0.1:$PORT"
echo
echo "Keep this Terminal window open while using Dreamwalker."
echo "Press Control+C here when finished."
echo

python3 "$SCRIPT_DIR/server.py"   --workspace "$WORKSPACE"   --repo-base "https://github.com/Queenbee-creator-tech/dreamwalker-book/blob/main"   --port "$PORT" &
SERVER_PID=$!

cleanup() {
  kill "$SERVER_PID" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

sleep 1
if ! kill -0 "$SERVER_PID" >/dev/null 2>&1; then
  echo "Dreamwalker could not start."
  read -r -p "Press Return to close..."
  exit 1
fi

open "http://127.0.0.1:$PORT"
wait "$SERVER_PID"
