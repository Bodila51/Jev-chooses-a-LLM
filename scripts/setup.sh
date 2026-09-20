#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "Installing dependencies..."
npm install

echo "Building..."
npm run build

echo "Running tests..."
npm test

LOCAL="${HOME}/.cursor/plugins/local/jev-router-for-cursor"
mkdir -p "$(dirname "$LOCAL")"
if [[ -L "$LOCAL" || -d "$LOCAL" ]]; then
  echo "Local plugin path already exists: $LOCAL"
else
  ln -s "$ROOT" "$LOCAL"
  echo "Linked plugin for local Cursor testing: $LOCAL"
fi

echo ""
echo "Next:"
echo "  1. Copy .env.example → .env and set TYPESAFE_API_KEY (and CURSOR_API_KEY for live SDK)"
echo "  2. npm run demo"
echo "  3. npm run mcp   # stdio MCP server"
echo "  4. Restart Cursor / enable the local plugin"
