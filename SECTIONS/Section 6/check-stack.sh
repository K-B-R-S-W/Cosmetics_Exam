#!/usr/bin/env bash
# infra/ec2/check-stack.sh -- quick health check of the EC2 box. Run before and during the exam: bash check-stack.sh
# Optional: LIVEKIT_HOST=Cosmetics.duckdns.org bash check-stack.sh
set -uo pipefail
ok(){ echo "  OK   $*"; }; bad(){ echo "  FAIL $*"; FAILED=1; }
FAILED=0
# docker needs root or the docker group; fall back to sudo so the check does not report false failures
DOCKER=docker; docker ps >/dev/null 2>&1 || DOCKER="sudo docker"
echo "== Services"
systemctl is-active --quiet exam-worker && ok "exam-worker running" || bad "exam-worker NOT running (journalctl -u exam-worker -n 50)"
for c in livekit caddy redis; do
  $DOCKER ps --format '{{.Names}}' | grep -q "$c" && ok "container $c up" || bad "container $c not running (cd /opt/exam-livekit && docker compose ps)"
done
echo "== Memory / disk / CPU"
free -m | awk '/Mem:/{printf "  mem used %d of %d MB\n",$3,$2} /Swap:/{printf "  swap used %d of %d MB\n",$3,$2}'
df -h / | awk 'NR==2{print "  disk used " $5 " of " $2}'
echo "  load: $(cut -d' ' -f1-3 /proc/loadavg)  (2 vCPUs; sustained load above 1.5 is high)"
if [[ -n "${LIVEKIT_HOST:-}" ]]; then
  echo "== HTTPS"
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://${LIVEKIT_HOST}/") && ok "https://${LIVEKIT_HOST}/ answered HTTP $code" || bad "no HTTPS answer from ${LIVEKIT_HOST}"
  end=$(echo | openssl s_client -servername "$LIVEKIT_HOST" -connect "${LIVEKIT_HOST}:443" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
  [[ -n "$end" ]] && ok "certificate expires: $end" || bad "could not read certificate"
fi
echo "== Time"
timedatectl show -p NTPSynchronized --value | grep -q yes && ok "clock synchronised" || bad "clock NOT synchronised (systemctl status chrony)"
exit $FAILED
