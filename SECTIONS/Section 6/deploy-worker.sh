#!/usr/bin/env bash
# infra/ec2/deploy-worker.sh -- build the worker from the repo and install it into /opt/exam-worker, then restart it.
# Run on the EC2 box from the repo root (the folder that contains worker/):  bash infra/ec2/deploy-worker.sh
# Needs: git checkout of the repo, sudo, and /etc/exam-worker.env already filled in.
set -euo pipefail
cd "$(dirname "$0")/../.."
[[ -d worker ]] || { echo "Run from the repo (worker/ not found)"; exit 1; }
echo "==> Build"
( cd worker && npm ci && npm run build )
echo "==> Install to /opt/exam-worker"
sudo rsync -a --delete --exclude node_modules worker/dist/ /opt/exam-worker/dist/
sudo cp worker/package.json worker/package-lock.json /opt/exam-worker/
( cd /opt/exam-worker && sudo npm ci --omit=dev )
sudo chown -R exam:exam /opt/exam-worker
echo "==> systemd unit"
sudo cp infra/ec2/exam-worker.service /etc/systemd/system/exam-worker.service
sudo systemctl daemon-reload
sudo systemctl enable exam-worker
sudo systemctl reset-failed exam-worker 2>/dev/null || true
sudo systemctl restart exam-worker
sleep 5
systemctl --no-pager --lines=15 status exam-worker || true
echo "Logs: journalctl -u exam-worker -f"
