"""Local-only release safety tests. No Docker, systemd, Azure or live secrets."""
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
          'subscriptionId': 'test', 'resourceGroup': 'dev', 'containerAppName': 'old-dev'}


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
        self.stack.enter_context(patch.object(vm, 'MAINTENANCE', vm.STATE / 'maintenance.json'))
        (vm.ROOT / 'releases').mkdir()
        # Avoid host ownership changes. Keep real atomic files/symlinks for tests.
        self.stack.enter_context(patch.object(vm.os, 'chown'))
        self.stack.enter_context(patch.object(vm.grp, 'getgrnam', return_value=Mock(gr_gid=1)))

    def artifact(self, image, schema='same'):
        target = vm.release_path(CONFIG, image)
        target.mkdir()
        vm.atomic_json(target / 'release.json', {'image': image, 'schema': schema}, mode=0o644)
        return target

    def existing(self):
        old = self.artifact(OLD_IMAGE)
        vm.activate_link(old)
        vm.atomic_json(vm.ETC / 'app.json', {'old': 'configuration'})
        return old

    def fake_deployment(self, target):
        mocks = {}
        for name in ('stage', 'application_env', 'verify_initial_cutover', 'enter_maintenance',
                     'drain', 'run', 'wait_ready', 'resume'):
            mocks[name] = self.stack.enter_context(patch.object(vm, name))
        mocks['stage'].return_value = target
        mocks['application_env'].return_value = {'new': 'configuration'}
        return mocks

    def test_only_environment_digest_is_accepted(self):
        self.assertEqual(vm.validate_image(CONFIG, IMAGE), DIGEST)
        for invalid in ['registry.azurecr.io/truecourse:latest', IMAGE.replace('registry', 'prod'),
                        IMAGE + '; touch bad', IMAGE.upper(), IMAGE[:-1]]:
            with self.subTest(image=invalid), self.assertRaises(ValueError):
                vm.validate_image(CONFIG, invalid)

    def test_first_activation_requires_explicit_flag(self):
        with patch.object(vm, 'stage') as stage, self.assertRaisesRegex(RuntimeError, 'initial-cutover'):
            vm.deploy(CONFIG, IMAGE)
        stage.assert_not_called()

    def test_initial_cutover_refuses_running_old_app(self):
        with patch.object(vm, 'azure_token', return_value='token'), patch.object(vm, 'fetch_json',
                return_value={'properties': {'runningStatus': 'Running'}}):
            with self.assertRaisesRegex(RuntimeError, 'must be stopped'):
                vm.verify_initial_cutover(CONFIG)

    def test_cutover_authorization_errors_are_not_absence(self):
        for code in (403, 404):
            error = urllib.error.HTTPError('https://test', code, 'test', {}, None)
            with patch.object(vm, 'azure_token', return_value='token'), patch.object(vm, 'fetch_json', side_effect=error):
                if code == 404:
                    vm.verify_initial_cutover(CONFIG)
                else:
                    with self.assertRaises(urllib.error.HTTPError):
                        vm.verify_initial_cutover(CONFIG)

    def test_initial_cutover_failure_does_not_enter_maintenance(self):
        mocks = self.fake_deployment(self.artifact(IMAGE))
        mocks['verify_initial_cutover'].side_effect = RuntimeError('old app still running')
        with self.assertRaises(RuntimeError):
            vm.deploy(CONFIG, IMAGE, initial_cutover=True)
        mocks['enter_maintenance'].assert_not_called()
        self.assertIsNone(vm.current_release())

    def test_schema_change_requires_explicit_opt_in_before_drain(self):
        old = self.existing()
        mocks = self.fake_deployment(self.artifact(IMAGE, 'changed'))
        with self.assertRaisesRegex(RuntimeError, 'Migration files changed'):
            vm.deploy(CONFIG, IMAGE)
        mocks['enter_maintenance'].assert_not_called()
        self.assertEqual(vm.current_release(), old)

    def test_drain_timeout_never_stops_old_service(self):
        old = self.existing()
        mocks = self.fake_deployment(self.artifact(IMAGE))
        mocks['drain'].side_effect = RuntimeError('drain timed out')
        with self.assertRaisesRegex(RuntimeError, 'drain timed out'):
            vm.deploy(CONFIG, IMAGE)
        mocks['run'].assert_not_called()
        self.assertEqual(vm.current_release(), old)
        self.assertEqual(vm.read_json(vm.ETC / 'app.json'), {'old': 'configuration'})

    def test_readiness_uses_real_operations_contract(self):
        health = {'database': 'ok', 'workerRunning': True, 'release': DIGEST, 'draining': True}
        with patch.object(vm, 'ops', return_value=health):
            self.assertEqual(vm.wait_ready(IMAGE), health)

    def test_wrong_release_is_not_ready(self):
        with patch.object(vm, 'ops', return_value={'database': 'ok', 'workerRunning': True, 'release': 'old'}), \
             patch.object(vm.time, 'monotonic', side_effect=[0, 0, 121]), patch.object(vm.time, 'sleep'):
            with self.assertRaisesRegex(RuntimeError, 'did not become ready'):
                vm.wait_ready(IMAGE)

    def test_drain_waits_until_stable_zero(self):
        with patch.object(vm, 'ops', side_effect=[{}, {'drained': False}, {'drained': True}]) as ops, \
             patch.object(vm.time, 'sleep'):
            vm.drain(20)
        self.assertEqual(ops.call_count, 3)
        ops.assert_any_call('/drain', 'POST')

    def test_failed_same_schema_release_restores_old_app_and_env(self):
        old = self.existing()
        mocks = self.fake_deployment(self.artifact(IMAGE))
        mocks['wait_ready'].side_effect = RuntimeError('new app failed')
        with self.assertRaisesRegex(RuntimeError, 'previous application release restored'):
            vm.deploy(CONFIG, IMAGE)
        self.assertEqual(vm.current_release(), old)
        self.assertEqual(vm.read_json(vm.ETC / 'app.json'), {'old': 'configuration'})
        mocks['resume'].assert_called_once_with(CONFIG)
        self.assertFalse((vm.STATE / 'last-success.json').exists())

    def test_failed_migrated_release_does_not_auto_rollback(self):
        self.existing()
        target = self.artifact(IMAGE, 'changed')
        mocks = self.fake_deployment(target)
        mocks['wait_ready'].side_effect = RuntimeError('new app failed')
        with self.assertRaisesRegex(RuntimeError, 'Schema compatibility requires review'):
            vm.deploy(CONFIG, IMAGE, allow_schema_change=True)
        self.assertEqual(vm.current_release(), target)
        self.assertEqual(vm.read_json(vm.STATE / 'database-schema.json'), {'schema': 'changed'})
        mocks['resume'].assert_not_called()
        with self.assertRaisesRegex(RuntimeError, 'rollback refused'):
            vm.rollback(CONFIG, 10)

    def test_success_records_digest_after_readiness(self):
        self.existing()
        target = self.artifact(IMAGE)
        self.fake_deployment(target)
        with contextlib.redirect_stdout(io.StringIO()) as output:
            vm.deploy(CONFIG, IMAGE)
        self.assertIn('TRUECOURSE_RELEASE_OK ' + DIGEST, output.getvalue())
        self.assertEqual(vm.current_release(), target)
        self.assertEqual(vm.read_json(vm.STATE / 'last-success.json')['image'], IMAGE)

    def test_repeating_same_digest_preserves_rollback_target(self):
        current = self.existing()
        previous = {'image': IMAGE, 'schema': 'same'}
        vm.atomic_json(vm.STATE / 'previous.json', previous)
        self.fake_deployment(current)
        with contextlib.redirect_stdout(io.StringIO()):
            vm.deploy(CONFIG, OLD_IMAGE)
        self.assertEqual(vm.read_json(vm.STATE / 'previous.json'), previous)

    def test_boot_resumes_only_without_maintenance_marker(self):
        self.existing()
        with patch.object(vm, 'wait_ready'), patch.object(vm, 'ops') as ops:
            vm.boot_ready(CONFIG)
            ops.assert_called_once_with('/resume', 'POST')
            ops.reset_mock()
            vm.MAINTENANCE.write_text('{}')
            vm.boot_ready(CONFIG)
            ops.assert_not_called()

    def test_https_failure_makes_private_healthy_app_unhealthy(self):
        health_log = vm.STATE / 'health.log'
        with patch.object(vm, 'HEALTH_LOG', health_log), \
             patch.object(vm, 'ops', return_value={'healthy': True, 'release': DIGEST}), \
             patch.object(vm.urllib.request, 'urlopen', side_effect=OSError('TLS failure')):
            vm.telemetry(CONFIG)
        health = json.loads(health_log.read_text())
        self.assertFalse(health['healthy'])
        self.assertFalse(health['httpsReady'])

    def test_maintenance_telemetry_does_not_probe_503_route(self):
        health_log = vm.STATE / 'health.log'
        vm.atomic_json(vm.MAINTENANCE, {'since': '2026-09-11T00:00:00+00:00'})
        with patch.object(vm, 'HEALTH_LOG', health_log), \
             patch.object(vm, 'ops', return_value={'healthy': True}), \
             patch.object(vm.urllib.request, 'urlopen') as public:
            vm.telemetry(CONFIG)
        public.assert_not_called()
        self.assertEqual(json.loads(health_log.read_text())['maintenanceSince'], '2026-09-11T00:00:00+00:00')

    def test_migration_fingerprint_tracks_content_and_journal(self):
        root = vm.ROOT / 'artifact'
        directory = root / 'app/packages/db/drizzle'
        directory.mkdir(parents=True)
        with self.assertRaisesRegex(RuntimeError, 'migration manifest'):
            vm.migration_hash(root)
        (directory / 'meta').mkdir()
        journal = directory / 'meta/_journal.json'
        journal.write_text('{}')
        before = vm.migration_hash(root)
        journal.write_text('{"entries": []}')
        self.assertNotEqual(before, vm.migration_hash(root))
        before = vm.migration_hash(root)
        (directory / '0001.sql').write_text('select 1;')
        self.assertNotEqual(before, vm.migration_hash(root))

    def test_environment_validates_database_and_keeps_existing_key(self):
        values = {name: 'configured' for name in vm.SECRET_NAMES}
        values.update(DATABASE_URL='postgresql://user:password@managed-dev.postgres.database.azure.com/app?sslmode=require',
                      TRUECOURSE_SECRET_KEY='original-key-' * 4)
        def secret(url, **kwargs):
            name = url.split('/secrets/')[1].split('?')[0].upper().replace('-', '_')
            if name == 'SENTRY_DSN':
                raise urllib.error.HTTPError(url, 404, 'absent', {}, None)
            return {'value': values[name]}
        with patch.object(vm, 'azure_token', return_value='never-print-token'), patch.object(vm, 'fetch_json', side_effect=secret):
            env = vm.application_env(CONFIG, IMAGE)
            self.assertEqual(env['TRUECOURSE_SECRET_KEY'], values['TRUECOURSE_SECRET_KEY'])
            self.assertEqual(env['WORKOS_REDIRECT_URI'], 'https://example.test/api/auth/callback')
            self.assertNotIn('SENTRY_DSN', env)
            values['DATABASE_URL'] = values['DATABASE_URL'].replace('managed-dev', 'managed-prod')
            with self.assertRaisesRegex(RuntimeError, 'managed server'):
                vm.application_env(CONFIG, IMAGE)
            values['DATABASE_URL'] = 'postgresql://user:password@managed-dev.postgres.database.azure.com/app'
            with self.assertRaisesRegex(RuntimeError, 'require TLS'):
                vm.application_env(CONFIG, IMAGE)


if __name__ == '__main__':
    unittest.main()
