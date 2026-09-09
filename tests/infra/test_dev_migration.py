"""Local-only deployment checks. Every Azure call uses the fake CLI below."""
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
FAKE_AZ = r'''
import json, os, sys
from pathlib import Path
p = Path(os.environ['FAKE_AZ_STATE'])
s = json.loads(p.read_text())
a = sys.argv[1:]
s['calls'].append(a)
p.write_text(json.dumps(s))
def flag(name): return a[a.index(name) + 1]
def save(): p.write_text(json.dumps(s))
def out(value): print(json.dumps(value))
def fail(message): sys.exit(message)
command = ' '.join(a[:3])
if s.get('fail_command') and command.startswith(s['fail_command']):
    fail('Simulated Azure API failure')
if a[:2] == ['acr', 'show']: print('registry.azurecr.io')
elif a[:2] == ['identity', 'show']: print('/identity')
elif a[:2] == ['keyvault', 'list']:
    out([{'name': 'dev-vault', 'properties': {'vaultUri': 'https://dev-vault.vault.azure.net/'}}] * s.get('vault_count', 1))
elif a[:2] == ['containerapp', 'list']:
    apps = []
    if s.get('legacy_exists', True):
        apps.append({'name': 'truecourse-dev', 'properties': {'managedEnvironmentId': '/managedEnvironments/' + s.get('legacy_env', 'truecourse-cae')}})
    if s.get('replacement'):
        apps.append({'name': 'truecourse-dev-v2', 'properties': {'environmentId': '/managedEnvironments/truecourse-dev-cae-v2'}})
    out(apps)
elif a[:3] == ['containerapp', 'revision', 'list']:
    assert '--all' in a
    out([{'name': r['name'], 'properties': {'active': r['active']}} for r in s['revisions']])
elif a[:3] == ['containerapp', 'revision', 'deactivate']:
    for r in s['revisions']:
        if r['name'] == flag('--revision'): r['active'] = False
    save()
elif a[:3] == ['containerapp', 'replica', 'list']:
    r = next(r for r in s['revisions'] if r['name'] == flag('--revision'))
    out([{'name': 'worker'}] if r.get('replicas', 0) else [])
    if not r['active'] and not s.get('stuck'):
        r['replicas'] = max(0, r.get('replicas', 0) - 1)
    save()
elif a[:3] == ['keyvault', 'secret', 'set']:
    assert not any(r['active'] or r.get('replicas') for r in s['revisions'])
    assert flag('-o') == 'none'
    s.setdefault('urls', {})[flag('--name')] = flag('--value')
    save()
elif a[:2] == ['acr', 'build']: pass
elif a[:3] == ['deployment', 'group', 'create']:
    template = flag('-f')
    assert 'foundation.bicep' not in template
    assert flag('--mode') == 'Incremental'
    if template.endswith('environment.bicep'):
        out({'environmentId': {'value': '/managedEnvironments/truecourse-dev-cae-v2'}, 'defaultDomain': {'value': 'example.azurecontainerapps.io'}})
    elif template.endswith('containerapp.bicep'):
        assert not any(r['active'] or r.get('replicas') for r in s['revisions'])
        for param in ['name=truecourse-dev-v2', 'cpu=4', 'memory=8Gi', 'workloadProfileName=Consumption', 'minReplicas=1', 'maxReplicas=1']:
            assert param in a, param
        if not s.get('replacement'):
            assert s['urls']['workos-app-url'] == 'https://truecourse-dev-v2.example.azurecontainerapps.io'
            assert s['urls']['workos-redirect-uri'].endswith('/api/auth/callback')
        s['replacement'] = True
        save()
        print('https://truecourse-dev-v2.example.azurecontainerapps.io')
    else: fail('Unexpected template: ' + template)
else: fail('Unexpected Azure call: ' + repr(a))
'''


class DevMigrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Use the repository's existing js-yaml dependency, not a new Python package.
        cls.steps = json.loads(subprocess.check_output([
            'node', '-e', 'console.log(JSON.stringify(require("js-yaml").load('
            'require("fs").readFileSync(".github/workflows/deploy-dev.yml", "utf8"))'
            '.jobs.deploy.steps))',
        ], cwd=ROOT))

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.state_file = self.directory / 'state.json'
        self.state_file.write_text(json.dumps({
            'calls': [],
            'revisions': [
                {'name': 'truecourse-dev--old', 'active': False, 'replicas': 0},
                {'name': 'truecourse-dev--current', 'active': True, 'replicas': 1},
            ],
        }))
        cli = self.directory / 'az'
        cli.write_text(f'#!{sys.executable}\n' + FAKE_AZ)
        cli.chmod(0o755)
        sleep = self.directory / 'sleep'
        sleep.write_text('#!/bin/sh\nexit 0\n')
        sleep.chmod(0o755)
        self.env = dict(os.environ, PATH=f'{self.directory}:{os.environ["PATH"]}',
                        FAKE_AZ_STATE=str(self.state_file),
                        GITHUB_STEP_SUMMARY=str(self.directory / 'summary'),
                        GITHUB_EVENT_NAME='workflow_dispatch',
                        GITHUB_SHA='1234567890abcdef', GITHUB_RUN_ID='1', GITHUB_RUN_ATTEMPT='1')

    def state(self):
        return json.loads(self.state_file.read_text())

    def configure(self, **kwargs):
        self.state_file.write_text(json.dumps(dict(self.state(), **kwargs)))

    def helper(self, mode, confirmation='jobs-drained-producers-paused'):
        return subprocess.run(['bash', 'infra/azure/legacy-app.sh', mode,
                               'rg-truecourse-dev', 'truecourse-dev', 'truecourse-cae'],
                              cwd=ROOT, env=dict(self.env, MIGRATION_CONFIRMATION=confirmation),
                              capture_output=True, text=True, timeout=30)

    def workflow(self, operation, confirmation='jobs-drained-producers-paused'):
        outputs = {}
        for step in self.steps:
            if 'run' not in step:
                continue
            condition = step.get('if')
            if condition == "env.OPERATION != 'prepare'" and operation == 'prepare':
                continue
            if condition == "env.OPERATION == 'migrate'" and operation != 'migrate':
                continue
            output_file = self.directory / 'output'
            output_file.write_text('')
            env = dict(self.env, OPERATION=operation, MIGRATION_CONFIRMATION=confirmation,
                       GITHUB_OUTPUT=str(output_file))
            for key, value in step.get('env', {}).items():
                if value == '${{ vars.AZURE_RG }}':
                    env[key] = 'rg-truecourse-dev'
                else:
                    match = re.fullmatch(r'\$\{\{ steps\.(\w+)\.outputs\.(\w+) }}', value)
                    self.assertIsNotNone(match, value)
                    env[key] = outputs[match[1]][match[2]]
            result = subprocess.run(['bash', '-e', '-o', 'pipefail', '-c', step['run']],
                                    cwd=ROOT, env=env, capture_output=True, text=True, timeout=30)
            if result.returncode:
                return result
            if 'id' in step:
                outputs[step['id']] = dict(line.split('=', 1) for line in output_file.read_text().splitlines())
        return result

    def mutations(self):
        return [c for c in self.state()['calls'] if
                any(verb in c[:3] for verb in ('create', 'set', 'deactivate', 'build'))]

    def test_prepare_never_starts_app_or_changes_secrets(self):
        result = self.workflow('prepare')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(self.mutations()), 1)
        self.assertIn('infra/azure/environment.bicep', self.mutations()[0])
        self.assertTrue(self.state()['revisions'][1]['active'])

    def test_migration_stops_every_worker_before_urls_and_app(self):
        result = self.workflow('migrate')
        self.assertEqual(result.returncode, 0, result.stderr)
        calls = self.state()['calls']
        build = next(i for i, c in enumerate(calls) if c[:2] == ['acr', 'build'])
        stop = next(i for i, c in enumerate(calls) if c[:3] == ['containerapp', 'revision', 'deactivate'])
        urls = next(i for i, c in enumerate(calls) if c[:3] == ['keyvault', 'secret', 'set'])
        app = next(i for i, c in enumerate(calls) if 'infra/azure/containerapp.bicep' in c)
        self.assertLess(build, stop)
        self.assertLess(stop, urls)
        self.assertLess(urls, app)
        self.assertTrue(self.state()['replacement'])

    def test_missing_confirmation_has_no_azure_calls(self):
        self.assertNotEqual(self.workflow('migrate', '').returncode, 0)
        self.assertEqual(self.state()['calls'], [])
        self.assertNotEqual(self.helper('deactivate', '').returncode, 0)
        self.assertEqual(self.state()['calls'], [])

    def test_normal_deploy_cannot_bootstrap_replacement(self):
        self.assertNotEqual(self.workflow('deploy').returncode, 0)
        self.assertEqual(self.mutations(), [])

    def test_normal_deploy_refuses_live_legacy(self):
        self.configure(replacement=True)
        self.assertNotEqual(self.workflow('deploy').returncode, 0)
        self.assertEqual(self.mutations(), [])

    def test_normal_deploy_updates_v2_without_deactivation_or_url_writes(self):
        self.configure(replacement=True, revisions=[{'name': 'old', 'active': False, 'replicas': 0}])
        result = self.workflow('deploy')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(any('deactivate' in c or 'secret' in c for c in self.mutations()))

    def test_migration_refuses_existing_replacement(self):
        self.configure(replacement=True)
        self.assertNotEqual(self.workflow('migrate').returncode, 0)
        self.assertEqual(self.mutations(), [])

    def test_stuck_replica_blocks_url_writes_and_replacement(self):
        self.configure(stuck=True)
        result = self.helper('deactivate')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('did not stop', result.stderr)
        self.assertFalse(any('secret' in c for c in self.state()['calls']))

    def test_inactive_revision_with_replica_is_not_stopped(self):
        self.configure(revisions=[{'name': 'inactive', 'active': False, 'replicas': 1}])
        self.assertNotEqual(self.helper('assert-stopped').returncode, 0)
        self.assertEqual(self.mutations(), [])

    def test_azure_errors_fail_closed(self):
        for command in ('containerapp list', 'containerapp revision list', 'containerapp replica list'):
            with self.subTest(command=command):
                self.configure(fail_command=command)
                self.assertNotEqual(self.helper('assert-stopped').returncode, 0)
        self.assertEqual(self.mutations(), [])

    def test_wrong_legacy_environment_cannot_be_deactivated(self):
        self.configure(legacy_env='production')
        self.assertNotEqual(self.helper('deactivate').returncode, 0)
        self.assertEqual(self.mutations(), [])

    def test_migration_can_resume_after_stop_before_app_creation(self):
        self.configure(revisions=[{'name': 'old', 'active': False, 'replicas': 0}])
        result = self.workflow('migrate')
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_missing_or_ambiguous_vault_blocks_mutation(self):
        for count in (0, 2):
            with self.subTest(count=count):
                self.configure(vault_count=count)
                self.assertNotEqual(self.workflow('migrate').returncode, 0)
        self.assertEqual(self.mutations(), [])

    def test_failed_url_write_never_starts_replacement(self):
        self.configure(fail_command='keyvault secret set')
        self.assertNotEqual(self.workflow('migrate').returncode, 0)
        self.assertFalse(self.state().get('replacement'))
        self.assertFalse(any('infra/azure/containerapp.bicep' in c for c in self.state()['calls']))

    def test_failed_deactivation_never_changes_urls_or_starts_replacement(self):
        self.configure(fail_command='containerapp revision deactivate')
        self.assertNotEqual(self.workflow('migrate').returncode, 0)
        self.assertFalse(self.state().get('urls'))
        self.assertFalse(self.state().get('replacement'))


if __name__ == '__main__':
    unittest.main()
