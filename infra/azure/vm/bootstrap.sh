#!/usr/bin/env bash
# Cloud-init bootstrap. Secrets are fetched through IMDS, never customData.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl gnupg git python3 build-essential unzip
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
cat >/etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: noble
Components: stable
Architectures: amd64
Signed-By: /etc/apt/keyrings/docker.asc
EOF
curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt -o /etc/apt/sources.list.d/caddy-stable.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin caddy
systemctl enable --now docker
id truecourse >/dev/null 2>&1 || useradd --create-home --home-dir /var/lib/truecourse/home --shell /bin/bash truecourse
usermod -aG docker truecourse
install -d -m 0750 /etc/truecourse /opt/truecourse /var/lib/truecourse/backups
install -d -o truecourse -g truecourse /var/lib/truecourse/home /var/log/truecourse

cat >/etc/systemd/system/truecourse.service <<'EOF'
[Unit]
Description=TrueCourse staging dashboard and guard worker
After=network-online.target docker.service
Wants=network-online.target
Requires=docker.service

[Service]
Type=simple
User=truecourse
Group=truecourse
SupplementaryGroups=docker
WorkingDirectory=/var/lib/truecourse/home
Environment=HOME=/var/lib/truecourse/home
Environment=PATH=/usr/local/bin:/usr/bin:/bin
ExecStart=/usr/bin/python3 /opt/truecourse/launch.py
Restart=on-failure
RestartSec=5
TimeoutStopSec=180
KillMode=control-group
UMask=0077

[Install]
WantedBy=multi-user.target
EOF
cat >/opt/truecourse/launch.py <<'EOF'
import json
import os
with open('/etc/truecourse/app.json') as stream:
    env = {**os.environ, **json.load(stream)}
os.execve('/usr/local/bin/node', ['node', '/opt/truecourse/app/apps/dashboard/server/dist/index.js'], env)
EOF
chmod 0755 /opt/truecourse/launch.py
systemctl daemon-reload
/usr/local/sbin/truecourse-vm prepare
touch /var/lib/truecourse/bootstrap-complete
# Deliberately start the app only AFTER the operator's snapshot/empty-db choice.
