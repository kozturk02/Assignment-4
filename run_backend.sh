#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
echo "Starting the backend on http://127.0.0.1:3001. Keep this terminal open."
npm run dev:backend
