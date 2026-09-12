#!/usr/bin/env python3
"""GitHub Actions implementation detail: update the VM and enable its alerts."""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import tempfile


def guest_script(image, source):
    checksum = hashlib.sha256(source).hexdigest()
    encoded = base64.b64encode(source).decode()
    # VM Run Command uses /bin/sh. Source is data, never shell interpolation.
    return '''#!/bin/sh
set -eu
test -f /var/lib/truecourse/deployment/bootstrap-complete
(
  flock -n 9
  tmp=$(mktemp /usr/local/sbin/.truecourse-vm.XXXXXX)
  trap 'rm -f "$tmp"' EXIT
  printf '%s' ENCODED | base64 -d >"$tmp"
  printf '%s  %s\\n' CHECKSUM "$tmp" | sha256sum -c - >/dev/null
  python3 -c 'import ast,sys; ast.parse(open(sys.argv[1]).read())' "$tmp"
  chown root:truecourse "$tmp"
  chmod 0750 "$tmp"
  mv "$tmp" /usr/local/sbin/truecourse-vm
) 9>/var/lib/truecourse/deployment/release.lock
# Schema changes are part of the reviewed PR/tag. The manager still refuses
# automatic rollback across migrations and never forces a busy worker to stop.
set -- /usr/local/sbin/truecourse-vm deploy IMAGE --allow-schema-change
if [ ! -L /opt/truecourse/current ]; then
  set -- "$@" --initial-cutover
fi
"$@"
'''.replace('ENCODED', shlex.quote(encoded)).replace('CHECKSUM', shlex.quote(checksum)).replace('IMAGE', shlex.quote(image))


def require_guest_success(result, digest):
    streams = []
    for value in result.get('value', []):
        code, message = value.get('code', ''), value.get('message', '')
        if code == 'ComponentStatus/StdOut/succeeded':
            streams.append(message)
        elif code == 'ProvisioningState/succeeded':
            # Action Run Command on Linux wraps both streams in one status.
            _, separator, output = message.partition('[stdout]\n')
            if separator:
                streams.append(output.partition('\n[stderr]')[0])
    stdout = '\n'.join(streams)
    marker = 'TRUECOURSE_RELEASE_OK ' + digest.split(':')[1]
    if marker not in stdout.splitlines():
        raise RuntimeError('VM release did not report success. Inspect VM logs before retrying. For first activation, verify the old Container App is stopped.')


def deploy(environment, outputs, digest, subscription):
    if environment not in ('dev', 'prod') or not re.fullmatch(r'sha256:[0-9a-f]{64}', digest):
        raise ValueError('Expected dev/prod and a full image digest')
    config = outputs['releaseConfig']['value']
    group = 'rg-truecourse-' + environment
    if config['environment'] != environment or config['resourceGroup'] != group:
        raise ValueError('VM deployment outputs belong to another environment')
    if not re.fullmatch(r'[a-z0-9]+\.azurecr\.io', config['registryLoginServer']):
        raise ValueError('Invalid registry in deployment outputs')
    image = config['registryLoginServer'] + '/truecourse@' + digest
    source = Path(__file__).with_name('vm-release.py').read_bytes()
    with tempfile.TemporaryDirectory(prefix='vm-release-') as directory:
        script = Path(directory, 'release.sh')
        script.write_text(guest_script(image, source))
        raw = subprocess.check_output(['az', 'vm', 'run-command', 'invoke', '--subscription', subscription,
            '--resource-group', group, '--name', config['vmName'], '--command-id', 'RunShellScript',
            '--scripts', '@' + str(script), '--output', 'json'], text=True)
        require_guest_success(json.loads(raw), digest)
        summary = os.environ.get('GITHUB_STEP_SUMMARY')
        if summary:
            with open(summary, 'a') as stream:
                stream.write(f"Deployed {environment}: {config['url']}\n\nImage: `{image}`\n")
        # Monitoring has its own template, so updating it never reapplies VM customData.
        parameters = Path(directory, 'monitoring.json')
        parameters.write_text(json.dumps({'parameters': outputs['monitoringParameters']['value']}))
        subprocess.run(['az', 'deployment', 'group', 'create', '--subscription', subscription,
            '--resource-group', group, '--name', 'truecourse-vm-monitoring-' + environment,
            '--template-file', 'infra/azure/vm-monitoring.bicep', '--parameters', '@' + str(parameters),
            '--output', 'none'], check=True)
    print('Deployment and monitoring ready: ' + config['url'])


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('environment', choices=['dev', 'prod'])
    parser.add_argument('outputs', type=Path)
    parser.add_argument('digest')
    args = parser.parse_args()
    deploy(args.environment, json.loads(args.outputs.read_text()), args.digest, os.environ['AZURE_SUBSCRIPTION_ID'])
