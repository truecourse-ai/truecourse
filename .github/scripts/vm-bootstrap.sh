#!/usr/bin/env bash
# Initial VM provisioning only. No database migration or application start.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl gnupg git python3 build-essential unzip rsyslog acl
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod 0644 /etc/apt/keyrings/docker.asc
cat >/etc/apt/sources.list.d/docker.sources <<'EOF'
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
install -d -m 0755 /var/lib/truecourse
id truecourse >/dev/null 2>&1 || useradd --create-home --home-dir /var/lib/truecourse/home --shell /bin/bash truecourse
usermod -aG docker truecourse
chown root:truecourse /usr/local/sbin/truecourse-vm
chmod 0750 /usr/local/sbin/truecourse-vm
install -d -m 0755 /opt/truecourse /opt/truecourse/releases
install -d -m 0750 -o root -g truecourse /etc/truecourse
install -d -m 0700 /var/lib/truecourse/deployment
install -d -o truecourse -g truecourse /var/lib/truecourse/home
# AMA reads these files; do not place secrets in application/health diagnostics.
install -d -m 0755 -o truecourse -g truecourse /var/log/truecourse
# AMA runs as syslog. Default ACLs keep new/rotated 0640 application logs readable
# without granting the agent access to the application's secret files.
setfacl -m u:syslog:rx,d:u:syslog:r-x,d:g::---,d:o::--- /var/log/truecourse

cat >/etc/systemd/system/truecourse.service <<'EOF'
[Unit]
Description=TrueCourse dashboard and Docker job worker
After=network-online.target docker.service
Wants=network-online.target
Requires=docker.service
ConditionPathExists=/opt/truecourse/current/app/apps/dashboard/server/dist/index.js

[Service]
Type=simple
User=truecourse
Group=truecourse
SupplementaryGroups=docker
WorkingDirectory=/var/lib/truecourse/home
Environment=HOME=/var/lib/truecourse/home
ExecStart=/usr/local/sbin/truecourse-vm launch
ExecStartPost=+/usr/local/sbin/truecourse-vm boot-ready
Restart=on-failure
RestartSec=5
TimeoutStartSec=180
# Deployment drains before stopping. A manual stop also must not SIGKILL jobs.
TimeoutStopSec=infinity
KillMode=mixed
UMask=0027

[Install]
WantedBy=multi-user.target
EOF

cat >/etc/systemd/system/truecourse-health.service <<'EOF'
[Unit]
Description=Write TrueCourse health telemetry for Azure Monitor
After=network-online.target
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/truecourse-vm telemetry
EOF
cat >/etc/systemd/system/truecourse-health.timer <<'EOF'
[Unit]
Description=Collect TrueCourse health once per minute
[Timer]
OnBootSec=60
OnUnitActiveSec=60
[Install]
WantedBy=timers.target
EOF
cat >/etc/logrotate.d/truecourse-health <<'EOF'
/var/log/truecourse/health.log {
  daily
  rotate 7
  missingok
  notifempty
  create 0644 root root
}
EOF
cat >/etc/logrotate.d/truecourse-app <<'EOF'
/var/log/truecourse/dashboard.log {
  daily
  maxsize 10M
  rotate 5
  missingok
  notifempty
  copytruncate
  su truecourse truecourse
}
EOF
systemctl daemon-reload
/usr/local/sbin/truecourse-vm initialize
systemctl enable truecourse
systemctl enable --now truecourse-health.timer
touch /var/lib/truecourse/deployment/bootstrap-complete
echo 'VM provisioned. Application remains stopped until explicit initial cutover.'
