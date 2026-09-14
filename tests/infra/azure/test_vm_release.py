"""Local-only release tests. No Docker, systemd, Azure or live secrets."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, Mock
import urllib.error

REPO = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location('vm_release', REPO / '.github/scripts/vm-release.py')
vm = importlib.util.module_from_spec(spec)
spec.loader.exec_module(vm)
DIGEST = 'a' * 64
IMAGE = 'registry.azurecr.io/truecourse@sha256:' + DIGEST
OLD_IMAGE = 'registry.azurecr.io/truecourse@sha256:' + 'b' * 64
CONFIG = {'registryLoginServer': 'registry.azurecr.io', 'databaseServerName': 'managed-dev',
          'keyVaultName': 'vault-dev', 'fqdn': 'example.test', 'environment': 'dev',
          'subscriptionId': 'test', 'resourceGroup': 'dev'}


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name).resolve()
        self.stack = contextlib.ExitStack()
        self.addCleanup(self.stack.close)
        for name, path in [('ROOT', root / 'opt'), ('ETC', root / 'etc'), ('STATE', root / 'state')]:
            path.mkdir()
            self.stack.enter_context(patch.object(vm, name, path))
        self.stack.enter_context(patch.object(vm, 'UNIT_FILE', root / 'truecourse.service'))
        (vm.ROOT / 'releases').mkdir()
        # Avoid host ownership changes. Keep real atomic files/symlinks for tests.
        self.stack.enter_context(patch.object(vm.os, 'chown'))
        self.stack.enter_context(patch.object(vm.grp, 'getgrnam', return_value=Mock(gr_gid=1)))

    def artifact(self, image):
        target = vm.release_path(CONFIG, image)
        target.mkdir()
        vm.atomic_json(target / 'release.json', {'image': image}, mode=0o644)
        return target

    def existing(self):
        old = self.artifact(OLD_IMAGE)
        vm.activate_link(old)
        vm.atomic_json(vm.ETC / 'app.json', {'release': 'old'})
        return old

    def fake_deployment(self, target):
        mocks = {name: self.stack.enter_context(patch.object(vm, name))
                 for name in ('stage', 'application_env', 'run', 'wait_ready')}
        mocks['stage'].return_value = target
        mocks['application_env'].side_effect = lambda config, image: {'release': image.split('sha256:')[-1][0]}
        return mocks

    def test_only_environment_digest_is_accepted(self):
        self.assertEqual(vm.validate_image(CONFIG, IMAGE), DIGEST)
        for invalid in ['registry.azurecr.io/truecourse:latest', IMAGE.replace('registry', 'prod'),
                        IMAGE + '; touch bad', IMAGE.upper(), IMAGE[:-1]]:
            with self.subTest(image=invalid), self.assertRaises(ValueError):
                vm.validate_image(CONFIG, invalid)

    def test_ready_means_the_new_release_answers(self):
        health = {'status': 'ok', 'release': DIGEST}
        with patch.object(vm, 'app_health', return_value=health):
            self.assertEqual(vm.wait_ready(IMAGE), health)

    def test_old_release_answering_is_not_ready(self):
        with patch.object(vm, 'app_health', return_value={'status': 'ok', 'release': 'old'}), \
             patch.object(vm.time, 'monotonic', side_effect=[0, 0, 121]), patch.object(vm.time, 'sleep'):
            with self.assertRaisesRegex(RuntimeError, 'did not become ready'):
                vm.wait_ready(IMAGE)

    def test_success_activates_release_and_prints_marker(self):
        self.existing()
        target = self.artifact(IMAGE)
        mocks = self.fake_deployment(target)
        with contextlib.redirect_stdout(io.StringIO()) as output:
            vm.deploy(CONFIG, IMAGE)
        self.assertIn('TRUECOURSE_RELEASE_OK ' + DIGEST, output.getvalue())
        self.assertEqual(vm.current_release(), target)
        self.assertEqual(vm.read_json(vm.ETC / 'app.json'), {'release': 'a'})
        self.assertEqual([c.args[0] for c in mocks['run'].call_args_list],
                         [['systemctl', 'daemon-reload'], ['systemctl', 'restart', 'truecourse']])
        self.assertEqual(vm.UNIT_FILE.read_text(), vm.UNIT)

    def test_env_failure_leaves_running_release_untouched(self):
        old = self.existing()
        mocks = self.fake_deployment(self.artifact(IMAGE))
        mocks['application_env'].side_effect = RuntimeError('vault unavailable')
        with self.assertRaisesRegex(RuntimeError, 'vault unavailable'):
            vm.deploy(CONFIG, IMAGE)
        mocks['run'].assert_not_called()
        self.assertEqual(vm.current_release(), old)
        self.assertEqual(vm.read_json(vm.ETC / 'app.json'), {'release': 'old'})

    def test_failed_release_restarts_previous(self):
        old = self.existing()
        mocks = self.fake_deployment(self.artifact(IMAGE))
        mocks['wait_ready'].side_effect = RuntimeError('new app failed')
        with self.assertRaisesRegex(RuntimeError, 'previous application release restarted'):
            vm.deploy(CONFIG, IMAGE)
        self.assertEqual(vm.current_release(), old)
        self.assertEqual(vm.read_json(vm.ETC / 'app.json'), {'release': 'b'})
        self.assertEqual([c.args[0] for c in mocks['run'].call_args_list].count(['systemctl', 'restart', 'truecourse']), 2)

    def test_failed_first_release_stays_active(self):
        target = self.artifact(IMAGE)
        mocks = self.fake_deployment(target)
        mocks['wait_ready'].side_effect = RuntimeError('new app failed')
        with self.assertRaisesRegex(RuntimeError, 'still active'):
            vm.deploy(CONFIG, IMAGE)
        self.assertEqual(vm.current_release(), target)
        mocks['run'].assert_any_call(['systemctl', 'restart', 'truecourse'])

    def test_failed_restart_restores_previous(self):
        old = self.existing()
        mocks = self.fake_deployment(self.artifact(IMAGE))
        restarts = []
        def run(args, **kwargs):
            if args[1] == 'restart':
                restarts.append(vm.current_release())
                if len(restarts) == 1:
                    raise vm.subprocess.CalledProcessError(1, args)
        mocks['run'].side_effect = run
        with self.assertRaisesRegex(RuntimeError, 'previous application release restarted'):
            vm.deploy(CONFIG, IMAGE)
        self.assertEqual(restarts[-1], old)
        self.assertEqual(vm.current_release(), old)
        mocks['wait_ready'].assert_not_called()

    def test_stale_unit_is_rewritten_once(self):
        self.existing()
        mocks = self.fake_deployment(self.artifact(IMAGE))
        vm.UNIT_FILE.write_text('[Service]\nExecStartPost=/usr/local/sbin/truecourse-vm boot-ready\n')
        with contextlib.redirect_stdout(io.StringIO()):
            vm.deploy(CONFIG, IMAGE)
            vm.deploy(CONFIG, IMAGE)
        self.assertEqual(vm.UNIT_FILE.read_text(), vm.UNIT)
        self.assertEqual([c.args[0] for c in mocks['run'].call_args_list].count(['systemctl', 'daemon-reload']), 1)

    def test_telemetry_records_public_health(self):
        health_log = vm.STATE / 'health.log'
        response = Mock(status=200)
        response.__enter__ = lambda self: self
        response.__exit__ = lambda self, *args: None
        response.read = lambda: json.dumps({'status': 'ok', 'release': DIGEST}).encode()
        with patch.object(vm, 'HEALTH_LOG', health_log), \
             patch.object(vm.urllib.request, 'urlopen', return_value=response):
            vm.telemetry(CONFIG)
        with patch.object(vm, 'HEALTH_LOG', health_log), \
             patch.object(vm.urllib.request, 'urlopen', side_effect=OSError('TLS failure')):
            vm.telemetry(CONFIG)
        records = [json.loads(line) for line in health_log.read_text().splitlines()]
        self.assertEqual([r['healthy'] for r in records], [True, False])
        self.assertEqual(records[0]['release'], DIGEST)

    def test_environment_validates_database_and_keeps_existing_key(self):
        values = {name: 'configured' for name in vm.SECRET_NAMES}
        values.update(DATABASE_URL='postgresql://user:password@managed-dev.postgres.database.azure.com/app?sslmode=require',
                      TRUECOURSE_SECRET_KEY='original-key-' * 4, TRUECOURSE_MAX_CONCURRENCY='8')
        absent = {'SENTRY_DSN', 'TRUECOURSE_MAX_API_CONCURRENCY'}
        def secret(url, **kwargs):
            name = url.split('/secrets/')[1].split('?')[0].upper().replace('-', '_')
            if name in absent:
                raise urllib.error.HTTPError(url, 404, 'absent', {}, None)
            return {'value': values[name]}
        with patch.object(vm, 'azure_token', return_value='never-print-token'), patch.object(vm, 'fetch_json', side_effect=secret):
            env = vm.application_env(CONFIG, IMAGE)
            self.assertEqual(env['TRUECOURSE_SECRET_KEY'], values['TRUECOURSE_SECRET_KEY'])
            self.assertEqual(env['WORKOS_REDIRECT_URI'], 'https://example.test/api/auth/callback')
            self.assertEqual(env['TRUECOURSE_RELEASE'], DIGEST)
            self.assertEqual(env['TRUECOURSE_MAX_CONCURRENCY'], '8')
            self.assertNotIn('SENTRY_DSN', env)
            self.assertNotIn('TRUECOURSE_MAX_API_CONCURRENCY', env)
            values['TRUECOURSE_MAX_CONCURRENCY'] = 'eight'
            with self.assertRaisesRegex(RuntimeError, 'positive integer'):
                vm.application_env(CONFIG, IMAGE)
            values['TRUECOURSE_MAX_CONCURRENCY'] = '8'
            values['DATABASE_URL'] = values['DATABASE_URL'].replace('managed-dev', 'managed-prod')
            with self.assertRaisesRegex(RuntimeError, 'managed server'):
                vm.application_env(CONFIG, IMAGE)
            values['DATABASE_URL'] = 'postgresql://user:password@managed-dev.postgres.database.azure.com/app'
            with self.assertRaisesRegex(RuntimeError, 'require TLS'):
                vm.application_env(CONFIG, IMAGE)


if __name__ == '__main__':
    unittest.main()
