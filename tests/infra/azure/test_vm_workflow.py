"""Exercise the GitHub release helper without calling Azure or a VM."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location('vm_deploy', ROOT / '.github/scripts/vm-deploy.py')
vm = importlib.util.module_from_spec(spec)
spec.loader.exec_module(vm)
DIGEST = 'sha256:' + 'a' * 64
OUTPUTS = {
    'releaseConfig': {'value': {'environment': 'dev', 'resourceGroup': 'rg-truecourse-dev',
        'vmName': 'truecourse-staging', 'registryLoginServer': 'registry.azurecr.io',
        'url': 'https://example.test'}},
    'monitoringParameters': {'value': {'enabled': {'value': True}}},
}


class WorkflowTests(unittest.TestCase):
    def test_run_command_api_success_is_not_guest_success(self):
        for stdout in ('', 'failed\n', 'TRUECOURSE_RELEASE_OK ' + 'b' * 64):
            with self.assertRaisesRegex(RuntimeError, 'did not report success'):
                vm.require_guest_success({'value': [{'code': 'ComponentStatus/StdOut/succeeded', 'message': stdout}]}, DIGEST)
        vm.require_guest_success({'value': [{'code': 'ComponentStatus/StdOut/succeeded',
                                'message': 'TRUECOURSE_RELEASE_OK ' + 'a' * 64}]}, DIGEST)

    def test_guest_payload_is_valid_posix_shell_and_quotes_source(self):
        script = vm.guest_script('registry.azurecr.io/truecourse@' + DIGEST, b'print("$secret; `touch bad`")')
        subprocess.run(['sh', '-n'], input=script, text=True, check=True)
        self.assertNotIn('touch bad', script)
        self.assertIn('--initial-cutover', script)
        self.assertIn('if [ ! -L /opt/truecourse/current ]', script)
        self.assertIn('chown root:truecourse', script)
        self.assertIn('--allow-schema-change', script)

    def test_linux_action_run_command_combined_streams(self):
        marker = 'TRUECOURSE_RELEASE_OK ' + 'a' * 64
        vm.require_guest_success({'value': [{'code': 'ProvisioningState/succeeded',
            'message': 'Enable succeeded: \n[stdout]\n' + marker + '\n\n[stderr]\n'}]}, DIGEST)
        for code, message in [
            ('ProvisioningState/succeeded', 'Enable succeeded: \n[stdout]\n\n[stderr]\n' + marker),
            ('ProvisioningState/failed', '[stdout]\n' + marker + '\n[stderr]\n'),
            ('ProvisioningState/succeeded', 'Enable succeeded: no release marker'),
        ]:
            with self.assertRaisesRegex(RuntimeError, 'did not report success'):
                vm.require_guest_success({'value': [{'code': code, 'message': message}]}, DIGEST)

    def test_wrong_environment_and_tags_never_reach_azure(self):
        with patch.object(vm.subprocess, 'check_output') as cloud:
            for environment, digest in [('prod', DIGEST), ('dev', 'latest'), ('other', DIGEST)]:
                with self.assertRaises(ValueError):
                    vm.deploy(environment, OUTPUTS, digest, 'subscription')
            cloud.assert_not_called()

    def test_failed_release_does_not_enable_monitoring(self):
        with patch.object(vm.subprocess, 'check_output', return_value=json.dumps({'value': []})), \
             patch.object(vm.subprocess, 'run') as monitoring:
            with self.assertRaises(RuntimeError):
                vm.deploy('dev', OUTPUTS, DIGEST, 'subscription')
            monitoring.assert_not_called()

    def test_success_enables_monitoring_without_reapplying_vm(self):
        result = {'value': [{'code': 'ComponentStatus/StdOut/succeeded', 'message': 'TRUECOURSE_RELEASE_OK ' + 'a' * 64}]}
        def monitor(args, **kwargs):
            self.assertEqual(args[args.index('--template-file') + 1], 'infra/azure/vm-monitoring.bicep')
            parameters = json.loads(Path(args[args.index('--parameters') + 1][1:]).read_text())
            self.assertTrue(parameters['parameters']['enabled']['value'])
        with patch.dict(os.environ, {'GITHUB_STEP_SUMMARY': ''}), \
             patch.object(vm.subprocess, 'check_output', return_value=json.dumps(result)) as release, \
             patch.object(vm.subprocess, 'run', side_effect=monitor) as monitoring:
            vm.deploy('dev', OUTPUTS, DIGEST, 'subscription')
            self.assertEqual(release.call_args.args[0][:4], ['az', 'vm', 'run-command', 'invoke'])
            monitoring.assert_called_once()


if __name__ == '__main__':
    unittest.main()
