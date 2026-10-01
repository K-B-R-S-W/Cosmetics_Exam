#!/usr/bin/env bash
# infra/ec2/setup-ec2.sh  -- one-time setup of the EC2 box (Ubuntu 24.04, t3.small). Run as: sudo bash setup-ec2.sh
# Safe to re-run. Does NOT start LiveKit or the worker (you do that after copying the config files).
set -euo pipefail

NODE_MAJOR="${NODE_MAJOR:-22}"       # use the current Node LTS (verify)
SWAP_GB="${SWAP_GB:-2}"

if [[ $EUID -ne 0 ]]; then echo "Run with sudo"; exit 1; fi

echo "==> Packages"
apt-get update -y
DEBIAN_FRONTEND=noninteractive apt-get upgrade -y
DEBIAN_FRONTEND=noninteractive apt-get install -y \
  ca-certificates curl gnupg unattended-upgrades chrony htop rsync docker.io docker-compose-v2 postgresql-client rclone

echo "==> Automatic security updates (no automatic reboot)"
dpkg-reconfigure -f noninteractive unattended-upgrades || true
cat >/etc/apt/apt.conf.d/52exam-no-reboot <<'CONF'
Unattended-Upgrade::Automatic-Reboot "false";
CONF

echo "==> Swap (${SWAP_GB} GB)"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l "${SWAP_GB}G" /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
echo 'vm.swappiness=10' >/etc/sysctl.d/99-exam-swap.conf
sysctl -p /etc/sysctl.d/99-exam-swap.conf >/dev/null

echo "==> Node.js ${NODE_MAJOR}"
if ! command -v node >/dev/null || [[ "$(node -p 'process.versions.node.split(".")[0]')" != "${NODE_MAJOR}" ]]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
fi

echo "==> Docker + service user"
systemctl enable --now docker chrony
id -u exam >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin exam
install -d -o exam -g exam -m 755 /opt/exam-worker
install -d -m 755 /opt/exam-livekit
install -d -m 700 /var/backups/exam

echo "==> Environment file placeholder for the worker (fill it in, keep it private)"
if [[ ! -f /etc/exam-worker.env ]]; then
  install -m 600 /dev/null /etc/exam-worker.env
  echo "# copy the contents of worker.env.example here" > /etc/exam-worker.env
fi

echo
echo "Done. Versions:"
node -v; docker --version; docker compose version; free -h | sed -n '1,2p'; swapon --show
echo "Time zone is UTC on purpose. The app converts Colombo time to UTC."
