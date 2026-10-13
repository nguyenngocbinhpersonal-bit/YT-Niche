#!/usr/bin/env sh
# Launcher for the MCP server inside Docker, for Claude Desktop / Claude Code.
#
# Point your MCP config at this script instead of a long `docker run` line:
#   "niche-finder": { "command": "/full/path/to/scripts/mcp-docker.sh" }
#
# It shares the same named volumes as `docker compose up worker`, so the tools
# see everything the background collector has gathered.
#
# The data itself lives in Postgres, in the `niche-finder_default` network
# that `docker compose up` creates -- this script must run AFTER that at least
# once, and joins that network by name so `POSTGRES_HOST=postgres` resolves.
set -eu
DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

ENV_FILE=""
[ -f "$DIR/.env" ] && ENV_FILE="$DIR/.env"
[ -z "$ENV_FILE" ] && [ -f "$DIR/backend/.env" ] && ENV_FILE="$DIR/backend/.env"

# IMPORTANT: `docker run --env-file` must NOT be used here.
# `docker compose` parses .env by dotenv rules and strips the quotes around
# the value, while `docker run --env-file` reads the line literally — and
# YOUTUBE_API_KEY="AIza..." goes into the container together with the quotes. Then
# the worker (via compose) works while the MCP server gets a broken key and EVERY
# call to the YouTube API fails. Exactly this broke the session on 6 September 2026.
# So we parse the file ourselves and strip the surrounding quotes.
set --
if [ -n "$ENV_FILE" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    line=$(printf '%s' "$line" | tr -d '\r')
    line=${line# }
    line=${line#export }
    case "$line" in
      ''|\#*) continue ;;
      *=*) ;;
      *) continue ;;
    esac
    name=${line%%=*}
    value=${line#*=}
    case "$name" in
      ''|*[!A-Za-z0-9_]*) continue ;;
      # NICHE_DATABASE_URL in .env describes the path to the database FROM THE HOST
      # (localhost:5433). Inside a container localhost is the container itself, and in
      # _dsn() this URL takes priority over POSTGRES_*, so it would override
      # POSTGRES_HOST=postgres below and break the MCP server. We leave it to the host.
      NICHE_DATABASE_URL) continue ;;
    esac
    case "$value" in
      '"'*'"') value=${value#\"}; value=${value%\"} ;;
      "'"*"'") value=${value#\'}; value=${value%\'} ;;
    esac
    set -- "$@" -e "$name=$value"
  done < "$ENV_FILE"
fi

# The code is mounted from the repository, so Claude Desktop always runs
# the current version — the image needs a rebuild only when requirements.txt changes.
exec docker run --rm -i \
  --network niche-finder_default \
  "$@" \
  -e POSTGRES_HOST=postgres \
  -v "$DIR/backend:/app:ro" \
  -v niche-finder-models:/models \
  niche-finder:latest python server.py
