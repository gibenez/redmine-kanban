#!/bin/sh
set -eu

# Run from the repository root, even when invoked from another directory.
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"

if ! docker compose version >/dev/null 2>&1; then
  printf '%s\n' 'Docker Compose v2 is required. Install and start Docker Desktop, then retry.' >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  printf '%s\n' 'Docker is not running. Start Docker Desktop or your Docker daemon, then retry.' >&2
  exit 1
fi

if [ ! -f .env ]; then
  cp .env.example .env
  printf '%s\n' 'Created .env from .env.example. Set REDMINE_URL and the actual status IDs, then rerun ./dev.sh.'
  exit 0
fi

printf '%s\n' \
  "Starting the development server at http://localhost:${DEV_PORT:-5173} (the first build may take a moment)." \
  'Edits under src/ and public/ sync into the container and refresh the browser.' \
  'Press Ctrl+C to stop.'
exec docker compose --profile dev watch dev
