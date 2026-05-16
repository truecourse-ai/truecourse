#!/usr/bin/env python3
"""
For each fixed-by-prior-work FP, read the ORIGINAL documenso file at the FP's
(file, line) location and copy the actual triggering code into a fresh fixture
file. The rule fired in documenso, so it MUST fire on the same content here.
"""
import os, json, subprocess, sys, re
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

# ── Load fbpw groups w/ representative file+line ──────────────────────────
rows = [json.loads(l) for l in FP_JSONL.read_text().strip().split('\n') if l.strip()]
fps = [r for r in rows if r.get('class') == 'FP']

# Group fbpw rows by (rule, shape_sig)
groups = defaultdict(list)
for r in fps:
    if r.get('status') == 'fixed-by-prior-work' and r.get('rule') not in excluded:
        key = (r['rule'], r['shape_sig'])
        groups[key].append(r)

print(f'fbpw groups: {len(groups)}')

# ── For each group, copy original file content ────────────────────────────
generated = 0
clone_missing = 0
file_missing = 0
deps_to_inline = {}  # mapping from import path → list of files needed

def safe_path(rule, shape_sig):
    """Generate a clean fixture path from rule+shape_sig."""
    parts = rule.split('/')
    domain = parts[0]  # bugs, code-quality, etc.
    name = parts[-1]
    s = shape_sig[:10]
    return f'fp-shapes-recovered/{domain}/{name}/{name}-{s}.ts'

for key, members in groups.items():
    rule, shape_sig = key
    # Pick first member as representative
    rep = members[0]
    file_rel = rep.get('file', '')
    line = rep.get('line', 0)
    if not file_rel or not line:
        continue

    clone_file = CLONE_ROOT / file_rel
    if not clone_file.exists():
        clone_missing += 1
        continue

    try:
        content = clone_file.read_text(errors='replace')
    except:
        file_missing += 1
        continue

    # Determine file extension based on original
    ext = file_rel.split('.')[-1] if '.' in file_rel else 'ts'
    if ext not in ('ts', 'tsx', 'js', 'jsx'):
        ext = 'ts'

    # Strip out the import statements (they may resolve to non-existent paths)
    # and replace external usages with declare const stubs.
    # Simplest approach: keep the whole file content. Add `// @ts-nocheck` at top
    # so TS errors don't break parsing? No — tree-sitter doesn't care.
    # Actually: just remove import statements entirely (rule logic mostly works
    # without imports for code-level rules).
    lines = content.split('\n')

    # For very large files (>500 lines), keep ±50 lines around the FP line
    # to reduce noise and resolve cross-file dependencies.
    keep_full = len(lines) <= 600
    if keep_full:
        snippet = '\n'.join(lines)
    else:
        start = max(0, line - 50)
        end = min(len(lines), line + 50)
        # Include any imports the snippet needs
        imports = [l for l in lines[:60] if l.strip().startswith('import ')]
        snippet = '\n'.join(imports + ['', '// ── snippet ──'] + lines[start:end])

    # Replace problematic imports with `declare` stubs
    # Strip `import ... from '...'` and `import '...'` lines that point outside
    # but keep `import type` since they don't affect runtime.
    cleaned = []
    for ln in snippet.split('\n'):
        s = ln.strip()
        if (s.startswith('import ') or s.startswith("import\t") or s.startswith('export {') or s.startswith('export *')) and ('from' in s or s.endswith(';')):
            # comment out
            cleaned.append(f'// {ln}')
        else:
            cleaned.append(ln)
    snippet = '\n'.join(cleaned)

    # Pick target file
    safe_rule = rule.replace('/', '_')
    parts = rule.split('/')
    domain = parts[0]
    name = parts[-1]
    new_target_rel = f'fp-shapes-recovered/{domain}/{name}/case-{shape_sig[:10]}.{ext}'
    new_target_abs = FIXTURE_BASE / new_target_rel
    new_target_abs.parent.mkdir(parents=True, exist_ok=True)
    new_target_abs.write_text(snippet)

    # Update scratch
    scratch_path = SCRATCH_DIR / f'{safe_rule}__{shape_sig}.json'
    if scratch_path.exists():
        try:
            d = json.loads(scratch_path.read_text())
            d['target_file'] = new_target_rel
            scratch_path.write_text(json.dumps(d, indent=2))
        except:
            pass
    generated += 1

print(f'Generated: {generated}, clone missing: {clone_missing}, read failed: {file_missing}')

# ── Re-run analyzer ───────────────────────────────────────────────────────
print('\nRe-running analyzer...')
result = subprocess.run(['node', str(SCRIPT), str(VIOLATIONS_OUT)],
                       capture_output=True, text=True, cwd=str(ROOT))
if result.returncode != 0:
    print('ERROR:', result.stderr[-2000:])
    sys.exit(1)
print(result.stderr.strip())

# ── Re-stamp ──────────────────────────────────────────────────────────────
violations = json.loads(VIOLATIONS_OUT.read_text())
viol_by_rule = {}
for v in violations:
    viol_by_rule.setdefault(v['ruleKey'], set()).add(v.get('filePath',''))

group_target = {}
for fname in os.listdir(SCRATCH_DIR):
    if not fname.endswith('.json'): continue
    try:
        d = json.loads((SCRATCH_DIR/fname).read_text())
    except:
        continue
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

# Summary
rows2 = [json.loads(l) for l in FP_JSONL.read_text().strip().split('\n') if l.strip()]
fps2 = [r for r in rows2 if r.get('class') == 'FP' and r.get('rule') not in excluded]
from collections import Counter
print('\nNon-excluded FP status:')
for s,c in Counter(r.get('status') for r in fps2).most_common():
    print(f'  {s}: {c}')

print('\nRemaining fixed-by-prior-work by rule:')
fbpw = [r for r in fps2 if r.get('status') == 'fixed-by-prior-work']
for rule, c in Counter(r['rule'] for r in fbpw).most_common(20):
    print(f'  {c:4d}  {rule}')
