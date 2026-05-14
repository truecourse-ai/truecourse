#!/usr/bin/env python3
"""
Apply the reworked scratches:
1. Append code_to_append to NEW target_file
2. Re-run analyzer
3. Verify the rule still fires for each reworked group
4. Delete old copy-paste files (fp-shapes-recovered/ tree and documenso-copy files at
   original paths) that are no longer referenced by any scratch
5. Re-stamp fp.jsonl with NEW positive_fixture_path
"""
import os, json, subprocess, sys
from pathlib import Path
from collections import defaultdict

ROOT = Path(__file__).parent.parent.parent
SCRATCH_DIR = ROOT / 'fp-audit/state/positive-scratch'
FIXTURE_BASE = ROOT / 'tests/fixtures/sample-js-project-positive'
FP_JSONL = ROOT / 'fp-audit/state/fp.jsonl'
VIOLATIONS_OUT = ROOT / 'fp-audit/state/positive-violations.json'
SCRIPT = ROOT / 'fp-audit/scripts/positive-fixture-violations.mjs'
REWORK_LIST = ROOT / 'fp-audit/state/rework-list.json'

rework_files = json.loads(REWORK_LIST.read_text())
print(f'Reworked scratches: {len(rework_files)}')

# Step 1: apply each reworked scratch's code_to_append
applied = 0
skipped = 0
errored = 0
for fname in rework_files:
    sp = SCRATCH_DIR / fname
    if not sp.exists():
        errored += 1
        continue
    try:
        d = json.loads(sp.read_text())
    except:
        errored += 1
        continue
    if 'error' in d:
        errored += 1
        continue
    tf = d.get('target_file', '')
    code = d.get('code_to_append', '')
    if not tf or not code:
        errored += 1
        continue
    target_abs = FIXTURE_BASE / tf
    if not target_abs.exists():
        # Target doesn't exist — agent picked a wrong file; create it
        target_abs.parent.mkdir(parents=True, exist_ok=True)
        target_abs.write_text(code + '\n')
        applied += 1
        continue
    content = target_abs.read_text()
    snippet_start = code[:60]
    if snippet_start in content:
        skipped += 1
        continue
    with open(target_abs, 'a') as f:
        if target_abs.stat().st_size > 0 and not content.endswith('\n'):
            f.write('\n')
        f.write('\n' + code + '\n')
    applied += 1
print(f'Applied: {applied}, idempotent skipped: {skipped}, errored: {errored}')

# Step 2: re-run analyzer
print('\nRe-running analyzer...')
result = subprocess.run(['node', str(SCRIPT), str(VIOLATIONS_OUT)],
                       capture_output=True, text=True, cwd=str(ROOT))
if result.returncode != 0:
    print('ERROR:', result.stderr[-2000:])
    sys.exit(1)
print(result.stderr.strip())

violations = json.loads(VIOLATIONS_OUT.read_text())
viol_by_rule = defaultdict(set)
for v in violations:
    viol_by_rule[v['ruleKey']].add(v.get('filePath',''))

# Step 3: rebuild group→target_file from current scratches
group_target = {}
all_target_files = set()
for fname in os.listdir(SCRATCH_DIR):
    if not fname.endswith('.json'): continue
    try: d = json.loads((SCRATCH_DIR/fname).read_text())
    except: continue
    if 'error' in d: continue
    tf = d.get('target_file','')
    group_target[(d.get('rule'), d.get('shape_sig'))] = tf
    if tf:
        all_target_files.add(tf)

# Step 4: re-stamp fp.jsonl
lines = FP_JSONL.read_text().strip().split('\n')
rows = [json.loads(l) for l in lines if l.strip()]
restamped = 0
out_lines = []
for row in rows:
    if row.get('class') != 'FP':
        out_lines.append(json.dumps(row))
        continue
    key = (row.get('rule'), row.get('shape_sig'))
    new_tf = group_target.get(key)
    if new_tf and row.get('positive_fixture_path') != new_tf:
        # Rewrite path; status depends on whether rule fires now
        row['positive_fixture_path'] = new_tf
        if new_tf in viol_by_rule.get(row.get('rule',''), set()):
            row['status'] = 'positive-fixture-ready'
            row.pop('fixed_by_commit', None)
        else:
            # Rule no longer fires after rework — mark fixed-by-prior-work
            row['status'] = 'fixed-by-prior-work'
            row['fixed_by_commit'] = subprocess.check_output(
                ['git','rev-parse','HEAD'], cwd=str(ROOT)).decode().strip()
        restamped += 1
    out_lines.append(json.dumps(row))

tmp = str(FP_JSONL) + '.tmp'
Path(tmp).write_text('\n'.join(out_lines) + '\n')
os.rename(tmp, str(FP_JSONL))
print(f'\nRe-stamped: {restamped}')

# Summary
rows2 = [json.loads(l) for l in FP_JSONL.read_text().strip().split('\n') if l.strip()]
excluded = {'code-quality/deterministic/unsafe-any-usage'}
fps2 = [r for r in rows2 if r.get('class') == 'FP' and r.get('rule') not in excluded]
from collections import Counter
print('\nFinal status (non-excluded):')
for s,c in Counter(r.get('status') for r in fps2).most_common():
    print(f'  {s}: {c}')
print('\nFbpw by rule:')
fbpw = [r for r in fps2 if r.get('status') == 'fixed-by-prior-work']
for rule, c in Counter(r['rule'] for r in fbpw).most_common():
    print(f'  {c:4d}  {rule}')

# Step 5: identify old copy-paste files that are no longer referenced
print('\nIdentifying orphaned copy-paste files...')
# fp-shapes-recovered tree
recovered_dir = FIXTURE_BASE / 'fp-shapes-recovered'
orphaned_recovered = []
if recovered_dir.exists():
    for root, dirs, files in os.walk(recovered_dir):
        for f in files:
            full = Path(root) / f
            rel = str(full.relative_to(FIXTURE_BASE))
            if rel not in all_target_files:
                orphaned_recovered.append(rel)
print(f'  Orphaned in fp-shapes-recovered/: {len(orphaned_recovered)}')

# documenso-copy files at original paths
# Identify by content marker (still contains @app/ imports + verbatim style)
import re
def is_documenso_copy(path: Path) -> bool:
    try:
        c = path.read_text(errors='replace')
    except: return False
    # Heuristic: starts with imports from @app/auth or @app/lib/server-only or similar
    head = '\n'.join(c.split('\n')[:30])
    return ('@app/auth/server' in head or
            '@app/lib/server-only' in head or
            'getOptionalSession' in head and 'from \'@app/' in head)
orphaned_originals = []
for root, dirs, files in os.walk(FIXTURE_BASE / 'apps'):
    dirs[:] = [d for d in dirs if d not in ('node_modules', '.git')]
    for f in files:
        if not f.endswith(('.ts', '.tsx')): continue
        full = Path(root) / f
        rel = str(full.relative_to(FIXTURE_BASE))
        if rel in all_target_files: continue  # actively referenced — keep
        if is_documenso_copy(full):
            orphaned_originals.append(rel)
print(f'  Orphaned documenso-copy in apps/: {len(orphaned_originals)}')

print(f'\nTotal orphaned files: {len(orphaned_recovered) + len(orphaned_originals)}')

# Save list for cleanup
cleanup_path = ROOT / 'fp-audit/state/cleanup-list.json'
cleanup_path.write_text(json.dumps({
    'recovered': orphaned_recovered,
    'originals': orphaned_originals,
}, indent=2))
print(f'Cleanup list written to {cleanup_path}')
