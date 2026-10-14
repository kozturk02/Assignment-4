#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Install Node.js 24 and npm before running this script."
  exit 1
fi

node -e "if (Number(process.versions.node.split('.')[0]) < 24) { console.error('Node.js 24 or newer is required.'); process.exit(1); }"
npm run setup
npm run build
npm run demo

echo "Setup complete. Run npm start and open http://127.0.0.1:3001."
echo "For development, use bash run_backend.sh and bash run_frontend.sh."
