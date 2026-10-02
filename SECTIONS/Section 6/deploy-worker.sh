#!/usr/bin/env bash
# infra/ec2/deploy-worker.sh -- build the worker from the repo and install it into /opt/exam-worker, then restart it.
# Run on the EC2 box from the repo root (the folder that contains worker/):  bash infra/ec2/deploy-worker.sh
# Needs: git checkout of the repo, sudo, and /etc/exam-worker.env already filled in.
set -euo pipefail
cd "$(dirname "$0")/../.."
[[ -d worker ]] || { echo "Run from the repo (worker/ not found)"; exit 1; }
echo "==> Build and test the production bundle"
# build must bundle shared TypeScript into dist/index.js. test:dist runs the built artifact
# from an otherwise empty temporary directory, so missing shared files/imports fail here.
( cd worker && npm ci && npm run build && npm run test:dist )
[[ -f worker/dist/index.js ]] || { echo "worker/dist/index.js was not produced"; exit 1; }
echo "==> Install to /opt/exam-worker"
sudo rsync -a --delete --exclude node_modules worker/dist/ /opt/exam-worker/dist/
sudo chown -R exam:exam /opt/exam-worker
sudo -u exam /usr/bin/node --check /opt/exam-worker/dist/index.js
echo "==> systemd unit"
sudo cp infra/ec2/exam-worker.service /etc/systemd/system/exam-worker.service
sudo systemctl daemon-reload
sudo systemctl enable exam-worker
sudo systemctl reset-failed exam-worker 2>/dev/null || true
sudo systemctl restart exam-worker
sleep 5
systemctl --no-pager --lines=15 status exam-worker || true
echo "Logs: journalctl -u exam-worker -f"
