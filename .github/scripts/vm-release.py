#!/usr/bin/env python3
"""Single-host application releases. No infrastructure provisioning or DB copying.

All mutating commands require root and a nonblocking flock. Azure credentials
stay in memory. Releases use immutable ACR digests and keep their own Node runtime.
"""
import argparse
import contextlib
import datetime
import fcntl
import grp
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
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
MAINTENANCE = STATE / 'maintenance.json'
OPS_TOKEN = ETC / 'ops-token'
HEALTH_LOG = Path('/var/log/truecourse/health.log')
SECRET_NAMES = ('DATABASE_URL', 'TRUECOURSE_SECRET_KEY', 'WORKOS_API_KEY',
                'WORKOS_CLIENT_ID', 'WORKOS_COOKIE_PASSWORD', 'GITHUB_APP_ID',
                'GITHUB_APP_PRIVATE_KEY', 'GITHUB_APP_WEBHOOK_SECRET', 'GITHUB_APP_SLUG',
                'SENTRY_DSN')


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


def migration_hash(release):
    directory = release / 'app/packages/db/drizzle'
    files = sorted(p for p in directory.rglob('*') if p.is_file())
    if not files or not (directory / 'meta/_journal.json').is_file():
        raise RuntimeError('Artifact is missing its database migration manifest')
    digest = hashlib.sha256()
    for path in files:
        digest.update(str(path.relative_to(directory)).encode() + b'\0' + path.read_bytes())
    return digest.hexdigest()


def current_release():
    current = ROOT / 'current'
    return current.resolve(strict=True) if current.is_symlink() else None


def activate_link(release):
    temp = ROOT / '.current-next'
    temp.unlink(missing_ok=True)
    temp.symlink_to(release)
    os.replace(temp, ROOT / 'current')


def stage(config, image):
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
        schema = migration_hash(temporary)
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
        atomic_json(temporary / 'release.json', {'image': image, 'schema': schema,
                                                'installedAt': utc_now()}, mode=0o644)
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
            if name == 'SENTRY_DSN' and error.code == 404:
                continue  # Error reporting is optional; access failures still fail the release.
            raise
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
                'SENTRY_ENVIRONMENT': 'production' if config['environment'] == 'prod' else 'staging',
                'SENTRY_RELEASE': validate_image(config, image),
                'TRUECOURSE_MAX_CONCURRENCY': '1', 'TRUECOURSE_MAX_API_CONCURRENCY': '1',
                'TRUECOURSE_OPS_PORT': '3002', 'TRUECOURSE_OPS_TOKEN_FILE': str(OPS_TOKEN),
                'TRUECOURSE_START_DRAINED': '1'})
    return env


def ops(path='/health', method='GET'):
    return fetch_json('http://127.0.0.1:3002' + path,
                      headers={'Authorization': 'Bearer ' + OPS_TOKEN.read_text().strip()},
                      data=b'{}' if method == 'POST' else None, method=method)


def wait_ready(image, timeout=120):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            health = ops()
            if (health.get('database') == 'ok' and health.get('workerRunning') is True
                    and health.get('release') == image.split('sha256:')[-1]):
                return health
        except (OSError, ValueError):
            pass
        time.sleep(2)
    raise RuntimeError('Application did not become ready; inspect dashboard.log')


def route(maintenance):
    content = ('header Retry-After 60\nrespond "Maintenance in progress" 503\n' if maintenance
               else 'reverse_proxy 127.0.0.1:3001\n')
    path = Path('/etc/caddy/truecourse-route.caddy')
    path.write_text(content)
    run(['caddy', 'validate', '--config', '/etc/caddy/Caddyfile'],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    run(['systemctl', 'reload', 'caddy'])


def enter_maintenance():
    atomic_json(MAINTENANCE, {'since': utc_now()})
    route(True)


def drain(timeout):
    ops('/drain', 'POST')
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if ops().get('drained') is True:
            return
        time.sleep(2)
    raise RuntimeError('Drain timed out. Existing jobs were not cancelled; use resume after investigation')


def resume(config):
    release = current_release()
    if not release:
        raise RuntimeError('There is no active release to resume')
    image = read_json(release / 'release.json')['image']
    wait_ready(image)
    ops('/resume', 'POST')
    route(False)
    try:
        with urllib.request.urlopen('https://' + config['fqdn'] + '/api/health', timeout=20) as response:
            public_health = json.load(response)
            if (response.status != 200 or public_health.get('status') != 'ok'
                    or public_health.get('release') != image.split('sha256:')[-1]):
                raise RuntimeError('Public HTTPS readiness check failed')
    except Exception:
        route(True)
        ops('/drain', 'POST')
        raise RuntimeError('Public HTTPS check failed; maintenance remains enabled') from None
    MAINTENANCE.unlink(missing_ok=True)


def verify_initial_cutover(config):
    url = ('https://management.azure.com/subscriptions/' + config['subscriptionId'] +
           '/resourceGroups/' + config['resourceGroup'] + '/providers/Microsoft.App/containerApps/' +
           config['containerAppName'] + '?api-version=2024-03-01')
    try:
        app = fetch_json(url, headers={'Authorization': 'Bearer ' +
                                     azure_token(config, 'https://management.azure.com/')})
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return
        raise
    if app.get('properties', {}).get('runningStatus') != 'Stopped':
        raise RuntimeError('Old Container App must be stopped before initial VM activation')


def deploy(config, image, *, initial_cutover=False, allow_schema_change=False, timeout=1800):
    previous = current_release()
    if previous is None and not initial_cutover:
        raise RuntimeError('First activation requires --initial-cutover after the old host is stopped')
    if previous is not None and initial_cutover:
        raise RuntimeError('--initial-cutover is only valid before the first release')
    target = stage(config, image)
    meta = read_json(target / 'release.json')
    old = read_json(previous / 'release.json') if previous else None
    if old and old['schema'] != meta['schema'] and not allow_schema_change:
        raise RuntimeError('Migration files changed; review backup/compatibility then pass --allow-schema-change')
    env = application_env(config, image)  # Fail before pausing the healthy app.
    if previous is None:
        verify_initial_cutover(config)
    enter_maintenance()
    if previous:
        drain(timeout)
        run(['systemctl', 'stop', 'truecourse'])
    old_env = (ETC / 'app.json').read_bytes() if (ETC / 'app.json').exists() else None
    if previous and previous != target:
        atomic_json(STATE / 'previous.json', old)
        if old_env:
            atomic_json(STATE / 'previous-env.json', json.loads(old_env))
    # Record before startup, because startup itself can migrate the database.
    atomic_json(STATE / 'database-schema.json', {'schema': meta['schema']})
    atomic_json(ETC / 'app.json', env, mode=0o640, app_readable=True)
    activate_link(target)
    try:
        run(['systemctl', 'start', 'truecourse'])
        wait_ready(image)
        resume(config)
    except Exception:
        # No new jobs admitted before resume. Once admission opens, drain first.
        try:
            drain(timeout)
        except OSError:
            pass  # Startup failed and there is no listening operations server.
        run(['systemctl', 'stop', 'truecourse'])
        if previous and old['schema'] == meta['schema']:
            activate_link(previous)
            atomic_json(ETC / 'app.json', json.loads(old_env), mode=0o640, app_readable=True)
            run(['systemctl', 'start', 'truecourse'])
            resume(config)
            raise RuntimeError('Release failed; previous application release restored') from None
        raise RuntimeError('Release failed; maintenance remains enabled. Schema compatibility requires review') from None
    atomic_json(STATE / 'last-success.json', {'image': image, 'deployedAt': utc_now()})
    print('TRUECOURSE_RELEASE_OK ' + image.split('sha256:')[-1])


def rollback(config, timeout):
    previous = read_json(STATE / 'previous.json')
    applied = read_json(STATE / 'database-schema.json')
    if applied['schema'] != previous['schema']:
        raise RuntimeError('Automatic rollback refused: database migration manifest changed')
    # deploy handles draining and restores the current artifact if rollback fails.
    deploy(config, previous['image'], timeout=timeout)


def launch():
    env = {**os.environ, **read_json(ETC / 'app.json')}
    release = current_release()
    if not release:
        raise RuntimeError('No installed application release')
    env['PATH'] = str(release / 'runtime/bin') + ':/usr/local/bin:/usr/bin:/bin'
    os.execve(str(release / 'runtime/bin/node'),
              ['node', str(release / 'app/apps/dashboard/server/dist/index.js')], env)


def boot_ready(config):
    release = current_release()
    wait_ready(read_json(release / 'release.json')['image'])
    if not MAINTENANCE.exists():
        ops('/resume', 'POST')


def telemetry(config):
    record = {'timestamp': utc_now(), 'healthy': False, 'failures': 0, 'stalledJobs': 0,
              'maintenance': MAINTENANCE.exists()}
    if MAINTENANCE.exists():
        record['maintenanceSince'] = read_json(MAINTENANCE)['since']
    try:
        health = ops()
        record.update({'healthy': health.get('healthy') is True,
                       'failures': health.get('failedLast15Minutes', 0),
                       'stalledJobs': int((health.get('oldestActiveAgeSeconds') or 0) > 3600),
                       'draining': health.get('draining', False)})
        if not record['maintenance']:
            record['httpsReady'] = False
            try:
                with urllib.request.urlopen('https://' + config['fqdn'] + '/api/health', timeout=20) as response:
                    public = json.load(response)
                    record['httpsReady'] = (response.status == 200 and public.get('status') == 'ok'
                                            and public.get('release') == health.get('release'))
            except (OSError, ValueError):
                pass
            record['healthy'] = record['healthy'] and record['httpsReady']
    except (OSError, ValueError):
        pass  # Explicit unhealthy telemetry, never a successful fallback.
    with HEALTH_LOG.open('a') as stream:
        stream.write(json.dumps(record) + '\n')


def initialize(config):
    if not re.fullmatch(r'[a-z0-9.-]+', config['fqdn']):
        raise ValueError('Invalid hostname')
    if not OPS_TOKEN.exists():
        OPS_TOKEN.write_text(secrets.token_hex(32) + '\n')
        OPS_TOKEN.chmod(0o640)
        os.chown(OPS_TOKEN, 0, grp.getgrnam('truecourse').gr_gid)
    if not current_release():
        atomic_json(MAINTENANCE, {'since': utc_now()})
        Path('/etc/caddy/truecourse-route.caddy').write_text('respond "Awaiting initial activation" 503\n')
    Path('/etc/caddy/Caddyfile').write_text(config['fqdn'] + ' {\n import /etc/caddy/truecourse-route.caddy\n}\n')
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
    parser.add_argument('command', choices=['initialize', 'stage', 'deploy', 'rollback',
                                            'maintenance', 'resume', 'launch', 'boot-ready', 'telemetry', 'status'])
    parser.add_argument('image', nargs='?')
    parser.add_argument('--initial-cutover', action='store_true')
    parser.add_argument('--allow-schema-change', action='store_true')
    parser.add_argument('--drain-timeout', type=int, default=1800)
    args = parser.parse_args()
    if args.command == 'launch':
        launch()
        return
    if os.geteuid() != 0:
        parser.error('Run management commands as root')
    if args.drain_timeout <= 0:
        parser.error('--drain-timeout must be positive')
    config = read_json(CONFIG_FILE)
    if args.command in ('stage', 'deploy') and not args.image:
        parser.error('An immutable image digest is required')
    if args.command in ('boot-ready', 'telemetry', 'status'):
        # boot-ready runs inside systemctl start while deploy holds the lock.
        if args.command == 'boot-ready': boot_ready(config)
        elif args.command == 'telemetry': telemetry(config)
        else: print(json.dumps(ops()))
        return
    with release_lock():
        if args.command == 'initialize': initialize(config)
        elif args.command == 'stage': stage(config, args.image)
        elif args.command == 'deploy': deploy(config, args.image, initial_cutover=args.initial_cutover,
            allow_schema_change=args.allow_schema_change, timeout=args.drain_timeout)
        elif args.command == 'rollback': rollback(config, args.drain_timeout)
        elif args.command == 'maintenance':
            enter_maintenance()
            drain(args.drain_timeout)
        elif args.command == 'resume': resume(config)


if __name__ == '__main__':
    try:
        main()
    except (Exception, KeyboardInterrupt) as error:
        # Avoid SDK/HTTP/command exception bodies: they may contain credentials.
        message = str(error) if isinstance(error, (RuntimeError, ValueError)) else type(error).__name__
        print('VM operation failed: ' + message, file=sys.stderr)
        sys.exit(1)
