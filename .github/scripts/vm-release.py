#!/usr/bin/env python3
"""Single-host application releases: stage an image, point `current` at it, restart.

A release is one immutable ACR digest unpacked under /opt/truecourse/releases with
its own Node runtime. `deploy` swaps the `current` symlink and restarts the systemd
unit; the process is down for the restart, and a job running at that moment ends
as "interrupted by server restart". Rolling back is deploying the previous digest.

Mutating commands require root and a nonblocking flock. Azure credentials stay in
memory; the app's env file is written 0640 root:truecourse.
"""
import argparse
import contextlib
import datetime
import fcntl
import grp
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

CONFIG_FILE = Path('/etc/truecourse-vm.json')
ETC = Path('/etc/truecourse')
ROOT = Path('/opt/truecourse')
STATE = Path('/var/lib/truecourse/deployment')
HEALTH_LOG = Path('/var/log/truecourse/health.log')
UNIT_FILE = Path('/etc/systemd/system/truecourse.service')
# Host configuration the release depends on ships with this helper, not with
# cloud-init: bootstrap runs once per VM, deploy runs on every release.
UNIT = '''[Unit]
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
Restart=on-failure
RestartSec=5
TimeoutStartSec=180
# A release restarts the unit. The server stops its worker on SIGTERM; a job
# still running is reaped as interrupted when the new process boots.
TimeoutStopSec=30
KillMode=mixed
UMask=0027

[Install]
WantedBy=multi-user.target
'''
APP_HEALTH_URL = 'http://127.0.0.1:3001/api/health'
SECRET_NAMES = ('DATABASE_URL', 'TRUECOURSE_SECRET_KEY', 'WORKOS_API_KEY',
                'WORKOS_CLIENT_ID', 'WORKOS_COOKIE_PASSWORD', 'GITHUB_APP_ID',
                'GITHUB_APP_PRIVATE_KEY', 'GITHUB_APP_WEBHOOK_SECRET', 'GITHUB_APP_SLUG',
                'GITHUB_APP_CLIENT_ID', 'GITHUB_APP_CLIENT_SECRET',
                'SENTRY_DSN', 'TRUECOURSE_MAX_CONCURRENCY', 'TRUECOURSE_MAX_API_CONCURRENCY')
# Absent in Key Vault means "use the app's default"; access failures still fail the release.
OPTIONAL_SECRETS = ('SENTRY_DSN', 'TRUECOURSE_MAX_CONCURRENCY', 'TRUECOURSE_MAX_API_CONCURRENCY')
INTEGER_SECRETS = ('TRUECOURSE_MAX_CONCURRENCY', 'TRUECOURSE_MAX_API_CONCURRENCY')


def run(args, **kwargs):
    # Never surface a CalledProcessError containing secret-bearing arguments.
    return subprocess.run(args, check=True, **kwargs)


def utc_now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def read_json(path):
    return json.loads(Path(path).read_text())


def atomic_json(path, value, mode=0o600, app_readable=False):
    path = Path(path)
    fd, temp = tempfile.mkstemp(dir=path.parent, prefix='.' + path.name)
    try:
        with os.fdopen(fd, 'w') as stream:
            json.dump(value, stream)
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temp, mode)
        if app_readable:
            os.chown(temp, 0, grp.getgrnam('truecourse').gr_gid)
        os.replace(temp, path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


@contextlib.contextmanager
def release_lock():
    with (STATE / 'release.lock').open('a') as stream:
        try:
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('Another VM management operation is running') from None
        yield


def fetch_json(url, *, headers=None, data=None, method=None):
    request = urllib.request.Request(url, headers=headers or {}, data=data, method=method)
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.load(response)


def azure_token(config, resource):
    query = urllib.parse.urlencode({'api-version': '2018-02-01', 'resource': resource,
                                   'client_id': config['identityClientId']})
    return fetch_json('http://169.254.169.254/metadata/identity/oauth2/token?' + query,
                      headers={'Metadata': 'true'})['access_token']


def validate_image(config, image):
    match = re.fullmatch(re.escape(config['registryLoginServer']) +
                         r'/truecourse@sha256:([0-9a-f]{64})', image)
    if not match:
        raise ValueError('Image must be a truecourse@sha256 digest in this environment\'s ACR')
    return match.group(1)


def release_path(config, image):
    return ROOT / 'releases' / validate_image(config, image)


def current_release():
    current = ROOT / 'current'
    return current.resolve(strict=True) if current.is_symlink() else None


def activate_link(release):
    temp = ROOT / '.current-next'
    temp.unlink(missing_ok=True)
    temp.symlink_to(release)
    os.replace(temp, ROOT / 'current')


def stage(config, image):
    """Unpack the image's /app and Node runtime into its release directory (idempotent)."""
    target = release_path(config, image)
    if target.exists():
        if read_json(target / 'release.json')['image'] != image:
            raise RuntimeError('Existing release metadata does not match image')
        return target
    temporary = Path(tempfile.mkdtemp(prefix='.install-', dir=ROOT / 'releases'))
    registry = config['registryLoginServer']
    try:
        # Dedicated Docker config avoids persisting registry credentials in root's home.
        with tempfile.TemporaryDirectory(prefix='truecourse-acr-') as auth:
            docker = ['docker', '--config', auth]
            exchange = fetch_json('https://' + registry + '/oauth2/exchange',
                headers={'Content-Type': 'application/x-www-form-urlencoded'},
                data=urllib.parse.urlencode({'grant_type': 'access_token', 'service': registry,
                    'tenant': config['tenantId'],
                    'access_token': azure_token(config, 'https://management.azure.com/')}).encode())
            run(docker + ['login', registry, '--username', '00000000-0000-0000-0000-000000000000',
                         '--password-stdin'], input=exchange['refresh_token'], text=True,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            run(docker + ['pull', image])
            container = run(docker + ['create', image], capture_output=True, text=True).stdout.strip()
            try:
                run(docker + ['cp', container + ':/app', str(temporary / 'app')])
                (temporary / 'runtime').mkdir()
                run(docker + ['cp', container + ':/usr/local/.', str(temporary / 'runtime')])
            finally:
                run(docker + ['rm', container], stdout=subprocess.DEVNULL)
        node = temporary / 'runtime/bin/node'
        entry = temporary / 'app/apps/dashboard/server/dist/index.js'
        if not node.is_file() or not entry.is_file():
            raise RuntimeError('Artifact lacks the dashboard server or Node runtime')
        # The Node image's Yarn links target /opt/yarn outside the copied runtime.
        # Replace package-manager links with Corepack's portable runtime-local shims.
        for name in ('pnpm', 'pnpx', 'yarn', 'yarnpkg'):
            shim = temporary / 'runtime/bin' / name
            if shim.is_symlink():
                shim.unlink()
        run([str(node), str(temporary / 'runtime/lib/node_modules/corepack/dist/corepack.js'),
             'enable', '--install-directory', str(temporary / 'runtime/bin')])
        cli = temporary / 'app/packages/guard-runner/node_modules/playwright-core/cli.js'
        run([str(node), str(cli), 'install-deps', 'chromium'])
        # mkdtemp defaults to 0700; the service user needs access for Playwright.
        temporary.chmod(0o755)
        run(['runuser', '-u', 'truecourse', '--', 'env', 'HOME=/var/lib/truecourse/home',
             str(node), str(cli), 'install', 'chromium'])
        atomic_json(temporary / 'release.json', {'image': image, 'installedAt': utc_now()}, mode=0o644)
        temporary.rename(target)
        return target
    finally:
        if temporary.exists():
            shutil.rmtree(temporary)


def application_env(config, image):
    token = azure_token(config, 'https://vault.azure.net')
    env = {}
    for name in SECRET_NAMES:
        url = ('https://' + config['keyVaultName'] + '.vault.azure.net/secrets/' +
               name.lower().replace('_', '-') + '?api-version=7.4')
        try:
            env[name] = fetch_json(url, headers={'Authorization': 'Bearer ' + token})['value']
        except urllib.error.HTTPError as error:
            if name in OPTIONAL_SECRETS and error.code == 404:
                continue
            raise
    for name in INTEGER_SECRETS:
        if name in env and not re.fullmatch(r'[1-9][0-9]*', env[name]):
            raise RuntimeError(name + ' in Key Vault must be a positive integer')
    db = urllib.parse.urlsplit(env['DATABASE_URL'])
    expected = config['databaseServerName'] + '.postgres.database.azure.com'
    ssl_mode = urllib.parse.parse_qs(db.query).get('sslmode', [''])[0]
    if db.scheme not in ('postgres', 'postgresql') or db.hostname != expected:
        raise RuntimeError('Key Vault database-url does not target this environment\'s managed server')
    if ssl_mode not in ('require', 'verify-ca', 'verify-full'):
        raise RuntimeError('Managed PostgreSQL connection must require TLS')
    if len(env['TRUECOURSE_SECRET_KEY']) < 32:
        raise RuntimeError('Existing database encryption key is invalid')
    env.update({'WORKOS_APP_URL': 'https://' + config['fqdn'],
                'WORKOS_REDIRECT_URI': 'https://' + config['fqdn'] + '/api/auth/callback',
                'NODE_ENV': 'production', 'PORT': '3001',
                'TRUECOURSE_LOG_DIR': '/var/log/truecourse',
                'SENTRY_ENVIRONMENT': 'production' if config['environment'] == 'prod' else 'dev',
                'TRUECOURSE_RELEASE': validate_image(config, image)})
    return env


def app_health():
    return fetch_json(APP_HEALTH_URL)


def wait_ready(image, timeout=120):
    """Poll the app's health until it answers as the given release."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            health = app_health()
            if health.get('status') == 'ok' and health.get('release') == image.split('sha256:')[-1]:
                return health
        except (OSError, ValueError):
            pass
        time.sleep(2)
    raise RuntimeError('Application did not become ready; inspect journalctl -u truecourse')


def install_unit():
    if UNIT_FILE.exists() and UNIT_FILE.read_text() == UNIT:
        return
    UNIT_FILE.write_text(UNIT)
    run(['systemctl', 'daemon-reload'])


def start_release(release, env):
    atomic_json(ETC / 'app.json', env, mode=0o640, app_readable=True)
    activate_link(release)
    run(['systemctl', 'restart', 'truecourse'])


def deploy(config, image):
    previous = current_release()
    target = stage(config, image)
    env = application_env(config, image)  # Fail before touching the running app.
    install_unit()
    try:
        start_release(target, env)
        wait_ready(image)
    except Exception:
        # Put the previous release back so the site is not left down. Its env is
        # re-read from Key Vault, the same source the new one used.
        if previous and previous != target:
            try:
                start_release(previous, application_env(config, read_json(previous / 'release.json')['image']))
            except Exception:
                raise RuntimeError('Release failed and the previous release could not be restarted') from None
            raise RuntimeError('Release failed; previous application release restarted') from None
        raise RuntimeError('Release failed; the new release is still active and unhealthy') from None
    print('TRUECOURSE_RELEASE_OK ' + image.split('sha256:')[-1])


def launch():
    env = {**os.environ, **read_json(ETC / 'app.json')}
    release = current_release()
    if not release:
        raise RuntimeError('No installed application release')
    env['PATH'] = str(release / 'runtime/bin') + ':/usr/local/bin:/usr/bin:/bin'
    os.execve(str(release / 'runtime/bin/node'),
              ['node', str(release / 'app/apps/dashboard/server/dist/index.js')], env)


def telemetry(config):
    """Append one JSON line per minute for the Azure Monitor health alerts."""
    record = {'timestamp': utc_now(), 'healthy': False, 'release': None}
    try:
        with urllib.request.urlopen('https://' + config['fqdn'] + '/api/health', timeout=20) as response:
            public = json.load(response)
            record.update({'healthy': response.status == 200 and public.get('status') == 'ok',
                           'release': public.get('release')})
    except (OSError, ValueError):
        pass  # Explicit unhealthy telemetry, never a successful fallback.
    with HEALTH_LOG.open('a') as stream:
        stream.write(json.dumps(record) + '\n')


def initialize(config):
    if not re.fullmatch(r'[a-z0-9.-]+', config['fqdn']):
        raise ValueError('Invalid hostname')
    install_unit()
    # Caddy is a fixed reverse proxy; it answers 502 while the app restarts.
    Path('/etc/caddy/Caddyfile').write_text(config['fqdn'] + ' {\n reverse_proxy 127.0.0.1:3001\n}\n')
    run(['caddy', 'validate', '--config', '/etc/caddy/Caddyfile'])
    run(['systemctl', 'enable', '--now', 'caddy'])
    run(['systemctl', 'reload', 'caddy'])
    for binary in ('node', 'npm', 'npx', 'corepack', 'pnpm', 'yarn'):
        link = Path('/usr/local/bin') / binary
        target = ROOT / 'current/runtime/bin' / binary
        if link.exists() or link.is_symlink():
            if not link.is_symlink() or os.readlink(link) != str(target):
                raise RuntimeError('Refusing to replace existing host tool: ' + binary)
        else:
            link.symlink_to(target)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['initialize', 'deploy', 'launch', 'telemetry', 'status'])
    parser.add_argument('image', nargs='?')
    args = parser.parse_args()
    if args.command == 'launch':
        launch()
        return
    if os.geteuid() != 0:
        parser.error('Run management commands as root')
    config = read_json(CONFIG_FILE)
    if args.command == 'deploy' and not args.image:
        parser.error('An immutable image digest is required')
    if args.command == 'telemetry':
        telemetry(config)
    elif args.command == 'status':
        print(json.dumps(app_health()))
    else:
        with release_lock():
            if args.command == 'initialize':
                initialize(config)
            else:
                deploy(config, args.image)


if __name__ == '__main__':
    try:
        main()
    except (Exception, KeyboardInterrupt) as error:
        # Avoid SDK/HTTP/command exception bodies: they may contain credentials.
        message = str(error) if isinstance(error, (RuntimeError, ValueError)) else type(error).__name__
        print('VM operation failed: ' + message, file=sys.stderr)
        sys.exit(1)
