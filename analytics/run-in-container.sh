#!/usr/bin/env bash
set -euo pipefail

command_name="${1:-interests}"
if [[ $# -gt 0 ]]; then
  shift
fi

container="${MAIL_DIGESTER_CONTAINER:-mail-digester}"
db_path="${MAIL_DIGESTER_CONTAINER_DB_PATH:-/app/data/mail-digester.sqlite}"

case "$command_name" in
  interests)
    script_path="/app/analytics/analyze-interests.mjs"
    ;;
  export)
    script_path="/app/analytics/export-interactions.mjs"
    ;;
  llm-context)
    script_path="/app/analytics/llm-context.mjs"
    ;;
  *)
    echo "Unknown analytics command: $command_name" >&2
    echo "Expected one of: interests, export, llm-context" >&2
    exit 2
    ;;
esac

docker exec "$container" node "$script_path" --db "$db_path" "$@"
