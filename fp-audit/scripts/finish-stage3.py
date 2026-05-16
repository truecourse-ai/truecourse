#!/usr/bin/env python3
"""
Finish stage 3: apply remaining unapplied scratches, re-run analyzer violations,
and stamp all fp.jsonl rows by (rule, shape_sig).
"""
import os, json, subprocess, sys, tempfile, shutil
from pathlib import Path

ROOT = Path(__file__).parent.parent.parent
SCRATCH_DIR = ROOT / 'fp-audit/state/positive-scratch'
FIXTURE_BASE = ROOT / 'tests/fixtures/sample-js-project-positive'
FP_JSONL = ROOT / 'fp-audit/state/fp.jsonl'
VIOLATIONS_OUT = ROOT / 'fp-audit/state/positive-violations.json'
EXCLUDED_RULES_PATH = ROOT / 'fp-audit/state/excluded-rules.json'
SCRIPT = ROOT / 'fp-audit/scripts/positive-fixture-violations.mjs'

excluded_rules = set()
if EXCLUDED_RULES_PATH.exists():
    excluded_rules = set(json.loads(EXCLUDED_RULES_PATH.read_text()))
print(f'Excluded rules: {excluded_rules}')

# ── Step 1: Apply unapplied scratches ──────────────────────────────────────
print('\n── Step 1: Apply unapplied scratches ──')
scratch_files = sorted(f for f in os.listdir(SCRATCH_DIR) if f.endswith('.json'))
applied_now = 0
skipped_idempotent = 0
skipped_error = 0

for fname in scratch_files:
    try:
        d = json.loads((SCRATCH_DIR / fname).read_text())
    except Exception as e:
        print(f'  PARSE ERROR {fname}: {e}')
        continue
    if 'error' in d:
        skipped_error += 1
        continue
    rule = d.get('rule', '')
    if rule in excluded_rules:
        continue
    target_file = d.get('target_file', '')
    code_to_append = d.get('code_to_append', '')
    if not target_file or not code_to_append:
        continue
    target_path = FIXTURE_BASE / target_file
    snippet_start = code_to_append[:60]
    if target_path.exists():
        content = target_path.read_text()
        if snippet_start in content:
            skipped_idempotent += 1
            continue
    else:
        target_path.parent.mkdir(parents=True, exist_ok=True)
    # Append with blank line separator
    with open(target_path, 'a') as f:
        if target_path.stat().st_size > 0:
            f.write('\n')
        f.write(code_to_append + '\n')
    applied_now += 1

print(f'  Applied: {applied_now}, Already present: {skipped_idempotent}, Error scratches: {skipped_error}')

# ── Step 2: Re-run analyzer violations ───────────────────────────────────
print('\n── Step 2: Run analyzer on positive fixture project ──')
result = subprocess.run(
    ['node', str(SCRIPT), str(VIOLATIONS_OUT)],
    capture_output=True, text=True, cwd=str(ROOT)
)
if result.returncode != 0:
    print('ERROR running violations script:')
    print(result.stderr[-3000:])
    sys.exit(1)
print(result.stderr.strip())
print(f'  Violations written to {VIOLATIONS_OUT}')

# ── Step 3: Build violations index ────────────────────────────────────────
print('\n── Step 3: Build violations index ──')
violations = json.loads(VIOLATIONS_OUT.read_text())
# Index: ruleKey → set of filePaths (relative)
viol_by_rule = {}
for v in violations:
    rk = v['ruleKey']
    fp = v.get('filePath') or ''
    if rk not in viol_by_rule:
        viol_by_rule[rk] = set()
    viol_by_rule[rk].add(fp)
print(f'  Total violations: {len(violations)}, unique rules: {len(viol_by_rule)}')

# ── Step 4: Build scratch group index ──────────────────────────────────────
print('\n── Step 4: Build scratch group index ──')
# group key: (rule, shape_sig) → target_file
group_target = {}
for fname in scratch_files:
    try:
        d = json.loads((SCRATCH_DIR / fname).read_text())
    except:
        continue
    if 'error' in d:
        continue
    rule = d.get('rule', '')
    if rule in excluded_rules:
        continue
    shape_sig = d.get('shape_sig', '')
    target_file = d.get('target_file', '')
    if rule and shape_sig and target_file:
        group_target[(rule, shape_sig)] = target_file

print(f'  Groups from scratch: {len(group_target)}')

# ── Step 5: Stamp fp.jsonl ─────────────────────────────────────────────────
print('\n── Step 5: Stamp fp.jsonl ──')
import hashlib
# Get analyzer HEAD
head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=str(ROOT)).decode().strip()

# Load fp.jsonl
lines = FP_JSONL.read_text().strip().split('\n')
rows = [json.loads(l) for l in lines if l.strip()]

stamped = 0
already_stamped = 0
unconfirmed_left = 0

out_lines = []
for row in rows:
    if row.get('class') != 'FP':
        out_lines.append(json.dumps(row))
        continue

    # Already stamped — skip
    if row.get('positive_fixture_path'):
        already_stamped += 1
        out_lines.append(json.dumps(row))
        continue

    rule = row.get('rule', '')
    shape_sig = row.get('shape_sig', '')

    # Excluded rules — leave unconfirmed
    if rule in excluded_rules:
        unconfirmed_left += 1
        out_lines.append(json.dumps(row))
        continue

    # Look up group
    target_file = group_target.get((rule, shape_sig))
    if not target_file:
        unconfirmed_left += 1
        out_lines.append(json.dumps(row))
        continue

    # Check if rule fires in target_file
    rule_files = viol_by_rule.get(rule, set())
    fires = target_file in rule_files

    row['positive_fixture_path'] = target_file
    if fires:
        row['status'] = 'positive-fixture-ready'
    else:
        row['status'] = 'fixed-by-prior-work'
        row['fixed_by_commit'] = head
    stamped += 1
    out_lines.append(json.dumps(row))

# Atomic write
tmp = str(FP_JSONL) + '.tmp'
with open(tmp, 'w') as f:
    f.write('\n'.join(out_lines) + '\n')
os.rename(tmp, str(FP_JSONL))

print(f'  Stamped: {stamped}')
print(f'  Already stamped: {already_stamped}')
print(f'  Unconfirmed (excluded or no scratch): {unconfirmed_left}')

# ── Summary ──────────────────────────────────────────────────────────────
print('\n═══ Stage 3 finish summary ═════════════════════')
rows_final = [json.loads(l) for l in FP_JSONL.read_text().strip().split('\n') if l.strip()]
fps = [r for r in rows_final if r.get('class') == 'FP']
statuses = {}
for r in fps:
    s = r.get('status', 'unconfirmed')
    statuses[s] = statuses.get(s, 0) + 1
for s, c in sorted(statuses.items()):
    print(f'  {s}: {c}')
print(f'  Total FPs: {len(fps)}')

# Count fixture-ready vs fixed-by-prior-work among non-excluded
non_excl = [r for r in fps if r.get('rule') not in excluded_rules]
ready = sum(1 for r in non_excl if r.get('status') == 'positive-fixture-ready')
fbpw = sum(1 for r in non_excl if r.get('status') == 'fixed-by-prior-work')
still_unconf = sum(1 for r in non_excl if r.get('status') == 'unconfirmed')
print(f'\n  Non-excluded FPs: {len(non_excl)}')
print(f'    positive-fixture-ready: {ready}')
print(f'    fixed-by-prior-work: {fbpw}')
print(f'    still unconfirmed: {still_unconf}')
print(f'    (still unconfirmed = groups with no scratch written)')
