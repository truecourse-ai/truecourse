#!/usr/bin/env python3
"""
Fix too-many-lines fixed-by-prior-work: make the function body > 50 lines.
"""
import os, json, re, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).parent.parent.parent
SCRATCH_DIR = ROOT / 'fp-audit/state/positive-scratch'
FIXTURE_BASE = ROOT / 'tests/fixtures/sample-js-project-positive'
FP_JSONL = ROOT / 'fp-audit/state/fp.jsonl'
VIOLATIONS_OUT = ROOT / 'fp-audit/state/positive-violations.json'
SCRIPT = ROOT / 'fp-audit/scripts/positive-fixture-violations.mjs'

RULE = 'code-quality/deterministic/too-many-lines'

rows = [json.loads(l) for l in FP_JSONL.read_text().strip().split('\n') if l.strip()]
fbpw_groups = set(
    (r['rule'], r['shape_sig']) for r in rows
    if r.get('class') == 'FP' and r.get('rule') == RULE and r.get('status') == 'fixed-by-prior-work'
)
print(f'Groups to fix: {len(fbpw_groups)}')

def find_function_body_range(lines):
    """
    Find the line range of the first 'real' function body (not declare).
    Returns (open_idx, close_idx) — line indices of { and }.
    """
    for i, line in enumerate(lines):
        stripped = line.strip()
        # Skip declare lines and type-only lines
        if stripped.startswith('declare ') or stripped.startswith('//') or stripped.startswith('*') or stripped.startswith('/*'):
            continue
        # Look for function/method/arrow opening brace
        if re.search(r'\bfunction\b|\b=>\s*\{|(?:async\s+)?\w+\s*\([^)]*\)\s*(?::\s*\S+\s*)?\{', stripped):
            # Find the matching opening brace
            if '{' in line:
                open_idx = i
                # Find matching closing brace
                depth = 0
                for j in range(i, len(lines)):
                    depth += lines[j].count('{') - lines[j].count('}')
                    if depth <= 0 and j > i:
                        return (open_idx, j)
    return None


def pad_function_body(code: str, target_lines: int = 55) -> str:
    """Pad the function body to exceed target_lines."""
    lines = code.split('\n')
    result = find_function_body_range(lines)
    if result is None:
        # No detectable function — append a new standalone function
        padding_func = ['\nfunction _syntheticLongFunction() {']
        for k in range(target_lines):
            padding_func.append(f'  const _step{k} = {k} + 1; // processing step {k}')
        padding_func.append('}')
        return code + '\n'.join(padding_func)

    open_idx, close_idx = result
    body_lines = close_idx - open_idx + 1
    if body_lines > 50:
        return code  # already long enough

    needed = target_lines - body_lines + 2
    indent = '  '
    # Detect indentation from existing body lines
    for l in lines[open_idx + 1:close_idx]:
        if l.strip():
            m = re.match(r'^(\s+)', l)
            if m:
                indent = m.group(1)
                break

    padding = [f'{indent}// processing step {k + 1}: validate and transform input' for k in range(needed)]
    new_lines = lines[:close_idx] + padding + lines[close_idx:]
    return '\n'.join(new_lines)


enhanced = 0
skipped = 0
already_ok = 0

for fname in sorted(os.listdir(SCRATCH_DIR)):
    if not fname.endswith('.json'):
        continue
    try:
        d = json.loads((SCRATCH_DIR / fname).read_text())
    except:
        continue
    if 'error' in d:
        continue
    key = (d.get('rule'), d.get('shape_sig'))
    if key not in fbpw_groups:
        continue

    original_code = d.get('code_to_append', '')
    target_file = d.get('target_file', '')
    if not original_code or not target_file:
        skipped += 1
        continue

    target_path = FIXTURE_BASE / target_file
    if not target_path.exists():
        skipped += 1
        continue

    enhanced_code = pad_function_body(original_code)
    if enhanced_code == original_code:
        already_ok += 1
        continue

    suffix = enhanced_code[len(original_code):]
    if not suffix.strip():
        already_ok += 1
        continue

    content = target_path.read_text()
    if original_code[:60] in content:
        insert_pos = content.find(original_code[:60])
        orig_end = insert_pos + len(original_code)
        new_content = content[:orig_end] + suffix + content[orig_end:]
    else:
        new_content = content + '\n' + enhanced_code + '\n'

    target_path.write_text(new_content)
    enhanced += 1

print(f'Enhanced: {enhanced}, Already OK: {already_ok}, Skipped: {skipped}')

# Re-run analyzer
print('\nRe-running analyzer...')
result = subprocess.run(['node', str(SCRIPT), str(VIOLATIONS_OUT)], capture_output=True, text=True, cwd=str(ROOT))
if result.returncode != 0:
    print('ERROR:', result.stderr[-2000:])
    sys.exit(1)
print(result.stderr.strip())

# Re-stamp fp.jsonl
violations = json.loads(VIOLATIONS_OUT.read_text())
rule_files = set(v['filePath'] for v in violations if v['ruleKey'] == RULE)

group_target = {}
for fname in os.listdir(SCRATCH_DIR):
    if not fname.endswith('.json'):
        continue
    try:
        d = json.loads((SCRATCH_DIR / fname).read_text())
    except:
        continue
    if 'error' in d or d.get('rule') != RULE:
        continue
    group_target[(d.get('rule'), d.get('shape_sig'))] = d.get('target_file', '')

lines = FP_JSONL.read_text().strip().split('\n')
rows = [json.loads(l) for l in lines if l.strip()]
advanced = 0
out_lines = []
for row in rows:
    if row.get('class') == 'FP' and row.get('rule') == RULE and row.get('status') == 'fixed-by-prior-work':
        tf = group_target.get((row.get('rule'), row.get('shape_sig')), '')
        if tf and tf in rule_files:
            row['status'] = 'positive-fixture-ready'
            row.pop('fixed_by_commit', None)
            advanced += 1
    out_lines.append(json.dumps(row))

tmp = str(FP_JSONL) + '.tmp'
Path(tmp).write_text('\n'.join(out_lines) + '\n')
os.rename(tmp, str(FP_JSONL))

print(f'\nAdvanced to positive-fixture-ready: {advanced}')
rows2 = [json.loads(l) for l in FP_JSONL.read_text().strip().split('\n') if l.strip()]
fps = [r for r in rows2 if r.get('class') == 'FP' and r.get('rule') == RULE]
from collections import Counter
for s, c in Counter(r.get('status') for r in fps).most_common():
    print(f'  {s}: {c}')
