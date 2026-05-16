#!/usr/bin/env python3
"""
For remaining fbpw groups: copy clone file PRESERVING the original directory
path. The analyzer's layer classifier and module resolver depend on path
structure — copying file content alone is not enough for architecture rules.
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
EXCLUDED_PATH = ROOT / 'fp-audit/state/excluded-rules.json'
CLONE_ROOT = Path('/tmp/audit-targets/documenso')

excluded = set(json.loads(EXCLUDED_PATH.read_text())) if EXCLUDED_PATH.exists() else set()

rows = [json.loads(l) for l in FP_JSONL.read_text().strip().split('\n') if l.strip()]
fps = [r for r in rows if r.get('class') == 'FP']
groups = defaultdict(list)
for r in fps:
    if r.get('status') == 'fixed-by-prior-work' and r.get('rule') not in excluded:
        groups[(r['rule'], r['shape_sig'])].append(r)
print(f'fbpw groups: {len(groups)}')

# For each, COPY entire FP file at its original path (sanitized for fs)
copied = 0
collected_imports = set()
for key, members in groups.items():
    rule, shape_sig = key
    rep = members[0]
    file_rel = rep.get('file', '')
    if not file_rel: continue
    clone_file = CLONE_ROOT / file_rel
    if not clone_file.exists(): continue

    try:
        content = clone_file.read_text(errors='replace')
    except: continue

    # Preserve original path
    dest = FIXTURE_BASE / file_rel
    # If dest already exists, skip (could be a real fixture file)
    if dest.exists():
        # Append a sentinel marker so the rule fires distinctly
        # Actually, just skip; we'll point scratch to the existing path
        pass
    else:
        dest.parent.mkdir(parents=True, exist_ok=True)
        # Comment out import lines that won't resolve
        cleaned = []
        for ln in content.split('\n'):
            s = ln.strip()
            if (s.startswith('import ') or s.startswith('export {') or s.startswith('export *')) and 'from' in s:
                # Extract the imported path
                import re
                m = re.search(r"from\s+['\"]([^'\"]+)['\"]", s)
                if m:
                    src = m.group(1)
                    # Keep relative imports — they may resolve
                    if src.startswith('./') or src.startswith('../'):
                        cleaned.append(ln)
                        continue
                cleaned.append(f'// {ln}')
            else:
                cleaned.append(ln)
        dest.write_text('\n'.join(cleaned))

    # Update scratch
    safe_rule = rule.replace('/', '_')
    scratch_path = SCRATCH_DIR / f'{safe_rule}__{shape_sig}.json'
    if scratch_path.exists():
        try:
            d = json.loads(scratch_path.read_text())
            d['target_file'] = file_rel
            scratch_path.write_text(json.dumps(d, indent=2))
        except: pass
    copied += 1

print(f'Files placed at original paths: {copied}')

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

# Check
for rule in ['architecture/deterministic/data-layer-depends-on-api',
             'architecture/deterministic/data-layer-depends-on-external',
             'database/deterministic/orm-lazy-load-in-loop',
             'database/deterministic/missing-unique-constraint',
             'code-quality/deterministic/type-import-side-effects']:
    print(f'{rule}: {len(viol_by_rule.get(rule, set()))} files')

# Re-stamp
group_target = {}
for fname in os.listdir(SCRATCH_DIR):
    if not fname.endswith('.json'): continue
    try: d = json.loads((SCRATCH_DIR/fname).read_text())
    except: continue
    if 'error' in d: continue
    group_target[(d.get('rule'), d.get('shape_sig'))] = d.get('target_file','')

lines = FP_JSONL.read_text().strip().split('\n')
rows = [json.loads(l) for l in lines if l.strip()]
advanced = 0
out_lines = []
for row in rows:
    if (row.get('class') == 'FP'
            and row.get('rule') not in excluded
            and row.get('status') == 'fixed-by-prior-work'):
        key = (row.get('rule'), row.get('shape_sig'))
        tf = group_target.get(key, '')
        if tf and tf in viol_by_rule.get(row.get('rule',''), set()):
            row['status'] = 'positive-fixture-ready'
            row['positive_fixture_path'] = tf
            row.pop('fixed_by_commit', None)
            advanced += 1
    out_lines.append(json.dumps(row))

tmp = str(FP_JSONL) + '.tmp'
Path(tmp).write_text('\n'.join(out_lines) + '\n')
os.rename(tmp, str(FP_JSONL))
print(f'\nAdvanced: {advanced}')

rows2 = [json.loads(l) for l in FP_JSONL.read_text().strip().split('\n') if l.strip()]
fps2 = [r for r in rows2 if r.get('class') == 'FP' and r.get('rule') not in excluded]
from collections import Counter
print('\nNon-excluded FP status:')
for s,c in Counter(r.get('status') for r in fps2).most_common():
    print(f'  {s}: {c}')
print('\nRemaining fbpw by rule:')
fbpw = [r for r in fps2 if r.get('status') == 'fixed-by-prior-work']
for rule, c in Counter(r['rule'] for r in fbpw).most_common():
    print(f'  {c:4d}  {rule}')
