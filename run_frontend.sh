#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
echo "Starting React on http://127.0.0.1:5173. Keep this terminal open."
npm run dev:frontend
