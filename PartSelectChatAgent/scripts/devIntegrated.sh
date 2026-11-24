#!/usr/bin/env bash
set -euo pipefail

frontend_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
backend_dir="$(cd "$frontend_dir/../ShoppingAgent" && pwd)"
python_bin="$backend_dir/.venv/bin/python"
if [[ ! -x "$python_bin" || ! -d "$frontend_dir/node_modules" ]]; then
  echo "Install both projects' dependencies first; see docs/current-delivery.md." >&2
  exit 1
fi
"$python_bin" -c 'import socket
for port in (3000, 8000):
    with socket.socket() as sock:
        try:
            sock.bind(("127.0.0.1", port))
        except OSError:
            raise SystemExit(f"Port {port} is already in use; existing services were not stopped.")'
cd "$frontend_dir"
npm run export:shopping
backend_pid=""
frontend_pid=""
cleanup() {
  trap - EXIT INT TERM
  [[ -z "$frontend_pid" ]] || kill "$frontend_pid" 2>/dev/null || true
  [[ -z "$backend_pid" ]] || kill "$backend_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM
node scripts/startPythonBackend.mjs &
backend_pid=$!
NEXT_TELEMETRY_DISABLED=1 node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3000 &
frontend_pid=$!
echo "Integrated demo: http://127.0.0.1:3000 — Ctrl+C stops only the two services started here."
wait -n "$backend_pid" "$frontend_pid"
