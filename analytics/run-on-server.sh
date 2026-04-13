#!/usr/bin/env bash
set -euo pipefail

command_name="${1:-interests}"
if [[ $# -gt 0 ]]; then
  shift
fi

ssh_host="${MAIL_DIGESTER_SSH_HOST:-lilfeel@lilfeel-ai-mf}"
container="${MAIL_DIGESTER_CONTAINER:-mail-digester}"
db_path="${MAIL_DIGESTER_CONTAINER_DB_PATH:-/app/data/mail-digester.sqlite}"

case "$command_name" in
  interests)
    ;;
  export)
    ;;
  llm-context)
    ;;
  *)
    echo "Unknown analytics command: $command_name" >&2
    echo "Expected one of: interests, export, llm-context" >&2
    exit 2
    ;;
esac

printf -v quoted_args " %q" "$@"
ssh "$ssh_host" "cd /home/lilfeel/Documents/mail-digester && MAIL_DIGESTER_CONTAINER=$container MAIL_DIGESTER_CONTAINER_DB_PATH=$db_path analytics/run-in-container.sh $command_name$quoted_args"
