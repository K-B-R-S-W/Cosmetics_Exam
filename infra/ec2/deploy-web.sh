#!/usr/bin/env bash
# infra/ec2/deploy-web.sh -- build the web app from the repo and install it into /opt/exam-web, then restart it.
# Run on the VPS from the repo root (the folder that contains apps/web/): bash infra/ec2/deploy-web.sh
# Needs: an existing exam user, /opt/exam-web, sudo, and /etc/exam-web.env already filled in with mode 600.
set -euo pipefail

validate_env_stream() {
  local line name value inline_comment_re
  local -i line_number=0
  local -A values=()
  local -A value_lines=()
  inline_comment_re='[[:space:]]+#'

  while IFS= read -r line || [[ -n "$line" ]]; do
    ((line_number += 1))
    line="${line%$'\r'}"
    [[ "$line" =~ ^[[:space:]]*$ ]] && continue
    [[ "$line" =~ ^[[:space:]]*# ]] && continue

    if [[ ! "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
      echo "Environment preflight failed: line $line_number variable <invalid> must use NAME=value" >&2
      return 1
    fi
    name="${BASH_REMATCH[1]}"
    value="${BASH_REMATCH[2]}"

    if [[ "$line" =~ $inline_comment_re ]]; then
      echo "Environment preflight failed: line $line_number variable $name has a trailing comment" >&2
      return 1
    fi
    if [[ "$name" == GEMINI_* ]]; then
      echo "Environment preflight failed: line $line_number variable $name is not allowed" >&2
      return 1
    fi

    values["$name"]="$value"
    value_lines["$name"]="$line_number"
  done

  for name in LIVEKIT_URL NEXT_PUBLIC_LIVEKIT_URL; do
    if [[ -z "${values[$name]+present}" ]]; then
      echo "Environment preflight failed: line 0 variable $name is missing" >&2
      return 1
    fi
    if [[ "${values[$name]}" != wss://* ]]; then
      echo "Environment preflight failed: line ${value_lines[$name]} variable $name must start with wss://" >&2
      return 1
    fi
  done

  name=ALLOWED_ORIGINS
  if [[ -z "${values[$name]+present}" ]]; then
    echo "Environment preflight failed: line 0 variable $name is missing" >&2
    return 1
  fi
  if [[ "${values[$name]}" != https://* ]]; then
    echo "Environment preflight failed: line ${value_lines[$name]} variable $name must start with https://" >&2
    return 1
  fi
}

assume_yes=false
if [[ "${1:-}" == "-y" ]]; then
  assume_yes=true
  shift
fi
if [[ $# -ne 0 ]]; then
  echo "Usage: bash infra/ec2/deploy-web.sh [-y]" >&2
  exit 2
fi

cd "$(dirname "$0")/../.."
[[ -d apps/web ]] || { echo "Run from the repo (apps/web/ not found)" >&2; exit 1; }
[[ -f /etc/exam-web.env ]] || { echo "/etc/exam-web.env is missing" >&2; exit 1; }
env_owner="$(sudo stat -c '%U:%G' /etc/exam-web.env)"
env_mode="$(sudo stat -c '%a' /etc/exam-web.env)"
[[ "$env_owner" == "root:root" && "$env_mode" == "600" ]] || {
  echo "/etc/exam-web.env must be owned by root:root with mode 600" >&2
  exit 1
}
unset env_owner env_mode
sudo cat /etc/exam-web.env | validate_env_stream
id exam >/dev/null 2>&1 || { echo "The exam user is missing; provision the VPS before deploying" >&2; exit 1; }
[[ -d /opt/exam-web ]] || { echo "/opt/exam-web is missing; provision the VPS before deploying" >&2; exit 1; }
[[ "$(readlink -f /opt/exam-web)" == "/opt/exam-web" ]] || {
  echo "/opt/exam-web must resolve to the expected install directory" >&2
  exit 1
}

echo "WARNING: restarting exam-web drops active exam browser connections."
if [[ "$assume_yes" != true ]]; then
  read -r -p "Continue with the web deployment? [y/N] " reply
  [[ "$reply" =~ ^[Yy]$ ]] || { echo "Deployment cancelled"; exit 0; }
fi

echo "==> Build the production web app as exam"
# Stream the root-owned environment file over stdin: values reach the build without
# being printed, written to shell history, or copied into the repository.
sudo cat /etc/exam-web.env | sudo -u exam /bin/bash -c '
  set -euo pipefail
  set -a
  source /dev/stdin
  set +a
  cd "$1"
  npm ci
  npm run build
' bash "$PWD/apps/web"
[[ -f apps/web/.next/BUILD_ID ]] || { echo "apps/web/.next/BUILD_ID was not produced" >&2; exit 1; }

echo "==> Install to /opt/exam-web"
# --delete-excluded ensures a build-time .next/cache is not copied or retained.
sudo rsync -a --delete --delete-excluded --exclude='cache/' apps/web/.next/ /opt/exam-web/.next/
sudo rsync -a --delete apps/web/public/ /opt/exam-web/public/
sudo install -m 0644 apps/web/package.json apps/web/package-lock.json /opt/exam-web/
sudo install -d -o exam -g exam -m 0755 /opt/exam-web/.next/cache
sudo chown -R exam:exam /opt/exam-web
sudo -u exam npm ci --omit=dev --prefix /opt/exam-web

echo "==> systemd unit"
sudo cp infra/ec2/exam-web.service /etc/systemd/system/exam-web.service
sudo systemctl daemon-reload
sudo systemctl enable exam-web
sudo systemctl reset-failed exam-web 2>/dev/null || true
sudo systemctl restart exam-web
sleep 5
systemctl --no-pager --lines=15 status exam-web || true
echo -n "Local HTTP status: "
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/
echo "Logs: journalctl -u exam-web -f"
