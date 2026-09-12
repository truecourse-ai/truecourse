#!/usr/bin/env python3
"""Manage the isolated VM. Run as root; never print secret values.

prepare: install the existing dev artifact and create local Postgres.
copy-dev: consistent, read-only dev snapshot into the EMPTY local database.
start: write VM-specific app config, start HTTPS and the application.
"""
import grp
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import time
import urllib.parse
import urllib.request

CONFIG = json.loads(Path('/etc/truecourse-vm.json').read_text())
STATE = Path('/etc/truecourse')
COMPOSE = ['docker', 'compose', '--project-name', 'truecourse-vm', '--env-file',
           str(STATE / 'db.env'), '-f', str(STATE / 'compose.yml')]


def run(argv, **kwargs):
    return subprocess.run(argv, check=True, **kwargs)


def request_json(url, *, headers=None, data=None):
    # Azure identity/RBAC and registries may take a moment to become available.
    for attempt in range(6):
        try:
            req = urllib.request.Request(url, headers=headers or {}, data=data)
            with urllib.request.urlopen(req, timeout=30) as response:
                return json.load(response)
        except Exception:
            if attempt == 5:
                raise RuntimeError('Identity or registry request failed; check VM access and network') from None
            time.sleep(min(2 ** attempt, 15))


def token(resource):
    query = urllib.parse.urlencode({'api-version': '2018-02-01', 'resource': resource,
                                   'client_id': CONFIG['identityClientId']})
    return request_json('http://169.254.169.254/metadata/identity/oauth2/token?' + query,
                        headers={'Metadata': 'true'})['access_token']


def secret(name):
    result = request_json(f"https://{CONFIG['keyVaultName']}.vault.azure.net/secrets/{name}?api-version=7.4",
                          headers={'Authorization': 'Bearer ' + token('https://vault.azure.net')})
    return result['value']


def secure_write(path, text, *, app_readable=False):
    path = Path(path)
    tmp = path.with_suffix(path.suffix + '.tmp')
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as stream:
        stream.write(text)
    if app_readable:
        os.chown(tmp, 0, grp.getgrnam('truecourse').gr_gid)
        os.chmod(tmp, 0o640)
    os.replace(tmp, path)


def local_password():
    return (STATE / 'db.env').read_text().strip().split('=', 1)[1]


def local_sql(sql, *, capture=False):
    return run(COMPOSE + ['exec', '-T', 'db', 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
                          '-U', 'truecourse', '-d', 'truecourse', '-Atc', sql],
               capture_output=capture, text=True)


def prepare():
    STATE.mkdir(exist_ok=True)
    for directory in [STATE, Path('/opt/truecourse')]:
        os.chown(directory, 0, grp.getgrnam('truecourse').gr_gid)
        os.chmod(directory, 0o750)
    if not (STATE / 'db.env').exists():
        secure_write(STATE / 'db.env', 'POSTGRES_PASSWORD=' + secrets.token_hex(32) + '\n')
    (STATE / 'compose.yml').write_text('''services:
  db:
    image: postgres:16-bookworm
    restart: unless-stopped
    environment:
      POSTGRES_USER: truecourse
      POSTGRES_DB: truecourse
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?required}
    ports:
      - "127.0.0.1:5432:5432"
    volumes:
      - /var/lib/truecourse/postgres:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U truecourse -d truecourse"]
      interval: 3s
      timeout: 3s
      retries: 30
    logging:
      driver: local
      options:
        max-size: "10m"
        max-file: "3"
''')
    run(COMPOSE + ['up', '-d', '--wait', 'db'])
    registry = CONFIG['image'].split('/')[0]
    access = token('https://management.azure.com/')
    exchange = request_json('https://' + registry + '/oauth2/exchange',
                            headers={'Content-Type': 'application/x-www-form-urlencoded'},
                            data=urllib.parse.urlencode({'grant_type': 'access_token',
                                'service': registry, 'tenant': CONFIG['tenantId'],
                                'access_token': access}).encode())
    run(['docker', 'login', registry, '--username', '00000000-0000-0000-0000-000000000000',
         '--password-stdin'], input=exchange['refresh_token'], text=True, stdout=subprocess.DEVNULL)
    try:
        run(['docker', 'pull', CONFIG['image']])
    finally:
        run(['docker', 'logout', registry], stdout=subprocess.DEVNULL)
    # Reuse the built Linux artifact and its Node runtime, without a second build.
    # The application runs on the host so recipe mounts and localhost agree.
    if Path('/opt/truecourse/app').exists():
        raise RuntimeError('Application is already installed; deploy an explicit new release instead of overwriting it')
    container = run(['docker', 'create', CONFIG['image']], capture_output=True, text=True).stdout.strip()
    try:
        run(['docker', 'cp', container + ':/app', '/opt/truecourse/app'])
        run(['docker', 'cp', container + ':/usr/local/.', '/usr/local/'])
    finally:
        run(['docker', 'rm', container], stdout=subprocess.DEVNULL)
    run(['chown', '-R', 'truecourse:truecourse', '/opt/truecourse/app'])
    install_browser()
    print('Docker, Postgres and the dev application artifact are ready. App is not started.')


def install_browser():
    cli = '/opt/truecourse/app/packages/guard-runner/node_modules/playwright-core/cli.js'
    run(['/usr/local/bin/node', cli, 'install-deps', 'chromium'])
    run(['runuser', '-u', 'truecourse', '--', 'env', 'HOME=/var/lib/truecourse/home',
         '/usr/local/bin/node', cli, 'install', 'chromium'])


def copy_dev():
    if subprocess.run(['systemctl', 'is-active', '--quiet', 'truecourse']).returncode == 0:
        raise RuntimeError('Stop the test application before importing a snapshot')
    count = local_sql("SELECT count(*) FROM information_schema.tables WHERE table_schema='public'", capture=True).stdout.strip()
    if count != '0':
        raise RuntimeError('The test database is not empty; refusing to overwrite it')
    source = urllib.parse.urlparse(secret('database-url'))
    if source.hostname in ('localhost', '127.0.0.1'):
        raise RuntimeError('Source must be the existing managed dev database')
    env = {**os.environ, 'PGHOST': source.hostname, 'PGPORT': str(source.port or 5432),
           'PGUSER': urllib.parse.unquote(source.username),
           'PGPASSWORD': urllib.parse.unquote(source.password),
           'PGDATABASE': source.path.lstrip('/'), 'PGSSLMODE': 'verify-full',
           'PGSSLROOTCERT': '/etc/ssl/certs/ca-certificates.crt',
           'PGOPTIONS': '-c default_transaction_read_only=on'}
    dump = Path('/var/lib/truecourse/backups/dev-initial.dump')
    args = ['docker', 'run', '--rm', '--network', 'host', '--mount',
            'type=bind,src=/etc/ssl/certs/ca-certificates.crt,dst=/etc/ssl/certs/ca-certificates.crt,readonly']
    for key in ['PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE', 'PGSSLMODE', 'PGSSLROOTCERT', 'PGOPTIONS']:
        args += ['--env', key]
    args += ['postgres:16-bookworm', 'pg_dump', '--format=custom', '--no-owner', '--no-acl',
             '--exclude-schema=graphile_worker']
    fd = os.open(dump, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'wb') as stream:
        run(args, env=env, stdout=stream)
    with dump.open('rb') as stream:
        run(COMPOSE + ['exec', '-T', 'db', 'pg_restore', '--exit-on-error', '--single-transaction',
                       '--no-owner', '--no-acl', '-U', 'truecourse', '-d', 'truecourse'], stdin=stream)
    # ONLY the copied database is changed. The source queue is never imported.
    local_sql('''DO $$ BEGIN
      IF to_regclass('public.jobs') IS NOT NULL THEN
        UPDATE jobs SET status='failed', error='Not replayed in isolated VM snapshot',
          finished_at=now() WHERE status IN ('queued','running');
      END IF;
      IF to_regclass('public.pending_baselines') IS NOT NULL THEN DELETE FROM pending_baselines; END IF;
      IF to_regclass('public.pending_guard_baselines') IS NOT NULL THEN DELETE FROM pending_guard_baselines; END IF;
      IF to_regclass('public.activity_runs') IS NOT NULL THEN
        UPDATE activity_runs SET owner=NULL, lease_until=NULL,
          record=record || jsonb_build_object('status','failed','finishedAt',now(),
             'error',jsonb_build_object('message','Not replayed in isolated VM snapshot'))
          WHERE record->>'status'='running';
      END IF;
    END $$;''')
    Path('/var/lib/truecourse/snapshot-complete').touch()
    print('Dev snapshot restored to local Postgres; copied queued work was not replayed.')


def start():
    names = ['TRUECOURSE_SECRET_KEY', 'WORKOS_API_KEY', 'WORKOS_CLIENT_ID', 'WORKOS_COOKIE_PASSWORD',
             'GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY', 'GITHUB_APP_WEBHOOK_SECRET', 'GITHUB_APP_SLUG']
    env = {name: secret(name.lower().replace('_', '-')) for name in names}
    env.update({'DATABASE_URL': 'postgres://truecourse:' + local_password() + '@127.0.0.1:5432/truecourse',
                'WORKOS_APP_URL': 'https://' + CONFIG['fqdn'],
                'WORKOS_REDIRECT_URI': 'https://' + CONFIG['fqdn'] + '/api/auth/callback',
                'NODE_ENV': 'production', 'PORT': '3001', 'TRUECOURSE_EDITION': 'enterprise',
                'TRUECOURSE_LOG_DIR': '/var/log/truecourse', 'SENTRY_ENVIRONMENT': 'staging-vm',
                'TRUECOURSE_MAX_CONCURRENCY': '1', 'TRUECOURSE_MAX_API_CONCURRENCY': '1'})
    secure_write(STATE / 'app.json', json.dumps(env), app_readable=True)
    # Webhooks remain routed to the existing dev instance. This test host exposes
    # the dashboard over HTTPS; neither Postgres nor Docker has a public listener.
    Path('/etc/caddy/Caddyfile').write_text(CONFIG['fqdn'] + ''' {
    @webhooks path /api/github/webhook /api/ee/github/webhook
    respond @webhooks 404
    reverse_proxy 127.0.0.1:3001
}
''')
    os.chmod('/etc/caddy/Caddyfile', 0o644)
    run(['caddy', 'validate', '--config', '/etc/caddy/Caddyfile'])
    run(['systemctl', 'enable', '--now', 'truecourse', 'caddy'])
    run(['systemctl', 'reload', 'caddy'])
    print('Started https://' + CONFIG['fqdn'])


if __name__ == '__main__':
    os.umask(0o077)
    if os.geteuid() != 0:
        sys.exit('Run as root')
    commands = {'prepare': prepare, 'copy-dev': copy_dev, 'start': start, 'install-browser': install_browser}
    if len(sys.argv) != 2 or sys.argv[1] not in commands:
        sys.exit('Usage: truecourse-vm prepare|copy-dev|start|install-browser')
    commands[sys.argv[1]]()
