#!/usr/bin/env python3
"""
Rule-specific generators for the 99 remaining copy-paste-dependent shapes.
Writes fresh natural code into existing themed fixture files, replaces the
scratch's target_file, re-runs analyzer, verifies, restamps.
"""
import os, json, subprocess, sys
from pathlib import Path
from collections import defaultdict

ROOT = Path(__file__).parent.parent.parent
SCRATCH_DIR = ROOT / 'fp-audit/state/positive-scratch'
FIXTURE = ROOT / 'tests/fixtures/sample-js-project-positive'
FP_JSONL = ROOT / 'fp-audit/state/fp.jsonl'
VIOLATIONS = ROOT / 'fp-audit/state/positive-violations.json'
SCRIPT = ROOT / 'fp-audit/scripts/positive-fixture-violations.mjs'

# Find scratches still pointing at fp-shapes-recovered
to_fix = []
for fname in os.listdir(SCRATCH_DIR):
    if not fname.endswith('.json'): continue
    try: d = json.loads((SCRATCH_DIR/fname).read_text())
    except: continue
    if 'error' in d: continue
    if d.get('target_file','').startswith('fp-shapes-recovered/'):
        to_fix.append((fname, d))
print(f'To fix: {len(to_fix)}')

# Map each rule to a target fixture file + code template builder
# Each generator returns (target_file_relative, code_snippet)

def fp_id(shape_sig: str) -> str:
    return shape_sig[:8]

# Pre-pick themed files per rule. We append unique snippets to each.
TARGET_FILES = {
    'bugs/deterministic/argument-type-mismatch': 'shared/utils/src/type-fixtures/argument-mismatches.ts',
    'code-quality/deterministic/magic-string': 'shared/utils/src/strings/magic-literals.ts',
    'bugs/deterministic/missing-error-boundary': 'services/web/src/routes/route-fixtures.tsx',
    'reliability/deterministic/unchecked-array-access': 'shared/utils/src/arrays/unchecked-accesses.ts',
    'code-quality/deterministic/filename-class-mismatch': 'shared/utils/src/mismatched-name-XX.ts',  # special: needs unique file per shape
    'database/deterministic/missing-transaction': 'services/api-gateway/src/db/multi-write-handlers.ts',
    'security/deterministic/timing-attack-comparison': 'services/api-gateway/src/auth/timing-comparisons.ts',
    'code-quality/deterministic/restricted-api-usage': 'shared/utils/src/dangerous-apis.ts',
    'bugs/deterministic/inconsistent-return': 'shared/utils/src/returns/inconsistent-returns.ts',
    'code-quality/deterministic/hardcoded-url': 'shared/utils/src/urls/hardcoded-endpoints.ts',
    'reliability/deterministic/catch-without-error-type': 'shared/utils/src/errors/untyped-catches.ts',
    'bugs/deterministic/use-before-define': 'shared/utils/src/scoping/use-before-define.ts',
    'code-quality/deterministic/magic-number': 'shared/utils/src/numbers/magic-numbers.ts',
    'security/deterministic/unpredictable-salt-missing': 'shared/utils/src/crypto/salt-fixtures.ts',
    'bugs/deterministic/void-return-value-used': 'shared/utils/src/returns/void-uses.ts',
    'code-quality/deterministic/mixed-type-imports': 'shared/utils/src/imports/mixed-types.ts',
}

# Per-rule snippet generators (return code string)

def gen_argument_type_mismatch(s):
    # Pattern: real TS function with typed param, call with explicit mismatched type
    return f'''
// shape {s}: argument-type-mismatch — wrong literal type
function processCount_{s}(count: number): number {{
  return count * 2;
}}
const _useMismatch_{s}: number = processCount_{s}("not a number" as any as string);
'''

def gen_magic_string(s):
    # Same string literal ≥3 times outside JSX/types/imports
    val = f'configuration-key-{s}'
    return f'''
// shape {s}: magic-string — same literal in property values
const _magicA_{s} = {{ key: '{val}' }};
const _magicB_{s} = {{ key: '{val}' }};
const _magicC_{s} = {{ key: '{val}' }};
'''

def gen_missing_error_boundary(s):
    # Remix-style route file that defines route component but no ErrorBoundary
    return f'''
// shape {s}: missing-error-boundary — Remix route without ErrorBoundary export
import {{ Outlet }} from "react-router";
export default function RouteView_{s}() {{
  return <Outlet />;
}}
export function loader_{s}() {{
  return {{ ok: true }};
}}
'''

def gen_unchecked_array_access(s):
    return f'''
// shape {s}: unchecked-array-access — indexed access, no guard
declare const items_{s}: Array<{{ name: string; value: number }}>;
declare const idx_{s}: number;
export function readItem_{s}(): string {{
  const picked = items_{s}[idx_{s}];
  return picked.name;
}}
'''

def gen_filename_class_mismatch(s):
    # Each shape needs its own unique file with mismatched name
    target_rel = f'shared/utils/src/mismatched/file-name-{s}.ts'
    code = f'''
export default class CompletelyDifferentClass_{s} {{
  performOperation(): void {{ /* noop */ }}
}}
'''
    return target_rel, code

def gen_missing_transaction(s):
    return f'''
// shape {s}: missing-transaction — multiple ORM writes without transaction
declare const repository_{s}: {{
  primaryTable: {{ create: (a: unknown) => Promise<unknown> }};
  secondaryTable: {{ update: (a: unknown) => Promise<unknown> }};
}};
export async function performMultiWrite_{s}(): Promise<void> {{
  await repository_{s}.primaryTable.create({{ data: {{ id: '{s}' }} }});
  await repository_{s}.secondaryTable.update({{ where: {{ id: '{s}' }}, data: {{ touched: true }} }});
}}
'''

def gen_timing_attack(s):
    return f'''
// shape {s}: timing-attack-comparison — equality on secret/token
declare const providedToken_{s}: string;
declare const expectedToken_{s}: string;
export function checkToken_{s}(): boolean {{
  if (providedToken_{s} === expectedToken_{s}) return true;
  return false;
}}
'''

def gen_restricted_api(s):
    # Use eval() — a commonly restricted API
    return f'''
// shape {s}: restricted-api-usage — eval is forbidden
export function runDynamicCode_{s}(source: string): unknown {{
  return eval(source);
}}
'''

def gen_inconsistent_return(s):
    return f'''
// shape {s}: inconsistent-return — some branches return value, some void
export function decideValue_{s}(n: number): number | undefined {{
  if (n > 0) return n * 2;
  if (n < 0) return;
  return 0;
}}
'''

def gen_hardcoded_url(s):
    return f'''
// shape {s}: hardcoded-url — full URL outside config
export const ENDPOINT_{s} = "https://api.production-endpoint-{s}.example.com/v1";
export const CALLBACK_{s} = "https://callbacks-{s}.example.com/notify";
'''

def gen_catch_without_error_type(s):
    return f'''
// shape {s}: catch-without-error-type — no instanceof/typeof on caught error
export async function performCatchedOp_{s}(): Promise<void> {{
  try {{
    throw new Error("operation-failed-{s}");
  }} catch (e) {{
    console.error("caught:", e);
    console.warn("noted");
  }}
}}
'''

def gen_use_before_define(s):
    return f'''
// shape {s}: use-before-define — caller defined before callee (const arrow)
export const callerBefore_{s} = (): number => helperAfter_{s}() + 1;
const helperAfter_{s} = (): number => 42;
'''

def gen_magic_number(s):
    seed = int(s, 16) % 9000 + 1000  # produces 4-digit non-whitelisted number
    return f'''
// shape {s}: magic-number — non-whitelisted numeric literal
export function priceLookup_{s}(units: number): number {{
  return units * {seed};
}}
'''

def gen_unpredictable_salt(s):
    return f'''
// shape {s}: unpredictable-salt-missing — fixed salt in password hash
declare const hashFn_{s}: (pw: string, salt: string) => string;
export function hashPassword_{s}(password: string): string {{
  return hashFn_{s}(password, "static-salt-{s}");
}}
'''

def gen_void_return_used(s):
    return f'''
// shape {s}: void-return-value-used — assigning void function result
function performSideEffect_{s}(input: number): void {{
  void input;
}}
export const usedVoid_{s}: unknown = performSideEffect_{s}(1) as unknown;
'''

def gen_mixed_type_imports(s):
    target_rel = f'shared/utils/src/imports/mixed-types-{s}.ts'
    helper_rel = f'shared/utils/src/imports/mixed-helper-{s}.ts'
    helper_code = f'''
export interface ConfigType_{s} {{ id: string; value: number }}
export function configure_{s}(c: ConfigType_{s}): void {{ void c; }}
'''
    # Same module imported both as type and as value in SEPARATE statements
    code = f'''
import {{ configure_{s} }} from "./mixed-helper-{s}";
import type {{ ConfigType_{s} }} from "./mixed-helper-{s}";
export function applyConfig_{s}(c: ConfigType_{s}): void {{
  configure_{s}(c);
}}
'''
    return target_rel, code, helper_rel, helper_code

GENERATORS = {
    'bugs/deterministic/argument-type-mismatch': gen_argument_type_mismatch,
    'code-quality/deterministic/magic-string': gen_magic_string,
    'bugs/deterministic/missing-error-boundary': gen_missing_error_boundary,
    'reliability/deterministic/unchecked-array-access': gen_unchecked_array_access,
    'code-quality/deterministic/filename-class-mismatch': gen_filename_class_mismatch,  # returns tuple
    'database/deterministic/missing-transaction': gen_missing_transaction,
    'security/deterministic/timing-attack-comparison': gen_timing_attack,
    'code-quality/deterministic/restricted-api-usage': gen_restricted_api,
    'bugs/deterministic/inconsistent-return': gen_inconsistent_return,
    'code-quality/deterministic/hardcoded-url': gen_hardcoded_url,
    'reliability/deterministic/catch-without-error-type': gen_catch_without_error_type,
    'bugs/deterministic/use-before-define': gen_use_before_define,
    'code-quality/deterministic/magic-number': gen_magic_number,
    'security/deterministic/unpredictable-salt-missing': gen_unpredictable_salt,
    'bugs/deterministic/void-return-value-used': gen_void_return_used,
    'code-quality/deterministic/mixed-type-imports': gen_mixed_type_imports,  # returns 4-tuple
}

# Reset target files (start fresh so accumulated content doesn't conflict)
for tf in set(TARGET_FILES.values()):
    if 'XX' in tf: continue  # special — per-shape
    full = FIXTURE / tf
    full.parent.mkdir(parents=True, exist_ok=True)
    # Seed with a header
    full.write_text('// Aggregated fixture for natural rule shape coverage.\n')

# Apply each scratch
applied = 0
errored = []
shape_to_target = {}  # (rule, shape_sig) → new target_file

for fname, d in to_fix:
    rule = d.get('rule', '')
    shape_sig = d.get('shape_sig', '')
    gen = GENERATORS.get(rule)
    if not gen:
        errored.append((rule, shape_sig, 'no generator'))
        continue
    s = fp_id(shape_sig)
    result = gen(s)
    if isinstance(result, str):
        # Simple case: snippet only, append to TARGET_FILES[rule]
        target_rel = TARGET_FILES[rule]
        snippet = result
        full = FIXTURE / target_rel
        with open(full, 'a') as f:
            f.write(snippet + '\n')
    elif len(result) == 2:
        # (target, code): unique file per shape
        target_rel, code = result
        full = FIXTURE / target_rel
        full.parent.mkdir(parents=True, exist_ok=True)
        full.write_text(code)
    elif len(result) == 4:
        # (target, code, helper, helper_code): file + helper
        target_rel, code, helper_rel, helper_code = result
        full = FIXTURE / target_rel
        full.parent.mkdir(parents=True, exist_ok=True)
        full.write_text(code)
        helper_full = FIXTURE / helper_rel
        helper_full.parent.mkdir(parents=True, exist_ok=True)
        helper_full.write_text(helper_code)
    # Update scratch
    d['target_file'] = target_rel
    (SCRATCH_DIR/fname).write_text(json.dumps(d, indent=2))
    shape_to_target[(rule, shape_sig)] = target_rel
    applied += 1

print(f'Applied: {applied}, errored: {len(errored)}')

# Re-run analyzer
print('\nRe-running analyzer...')
r = subprocess.run(['node', str(SCRIPT), str(VIOLATIONS)], capture_output=True, text=True, cwd=str(ROOT))
print(r.stderr.strip())

violations = json.loads(VIOLATIONS.read_text())
viol_by_rule = defaultdict(set)
for v in violations:
    viol_by_rule[v['ruleKey']].add(v.get('filePath',''))

# Check each new target
hits = 0
misses = []
for (rule, shape_sig), tf in shape_to_target.items():
    if tf in viol_by_rule.get(rule, set()):
        hits += 1
    else:
        misses.append((rule, shape_sig, tf))
print(f'Hits: {hits}, Misses: {len(misses)}')
if misses[:10]:
    print('Sample misses:')
    for rule, sig, tf in misses[:10]:
        short = rule.split('/')[-1]
        print(f'  {short} :: {sig[:10]} :: {tf}')

# Restamp fp.jsonl
group_target = {}
for fname in os.listdir(SCRATCH_DIR):
    if not fname.endswith('.json'): continue
    try: dd = json.loads((SCRATCH_DIR/fname).read_text())
    except: continue
    if 'error' in dd: continue
    group_target[(dd.get('rule'), dd.get('shape_sig'))] = dd.get('target_file','')

lines = FP_JSONL.read_text().strip().split('\n')
rows = [json.loads(l) for l in lines if l.strip()]
out_lines = []
restamped = 0
for row in rows:
    if row.get('class') == 'FP':
        key = (row.get('rule'), row.get('shape_sig'))
        tf = group_target.get(key, '')
        if tf and tf != row.get('positive_fixture_path'):
            row['positive_fixture_path'] = tf
            if tf in viol_by_rule.get(row.get('rule',''), set()):
                row['status'] = 'positive-fixture-ready'
                row.pop('fixed_by_commit', None)
            restamped += 1
    out_lines.append(json.dumps(row))
tmp = str(FP_JSONL) + '.tmp'
Path(tmp).write_text('\n'.join(out_lines) + '\n')
os.rename(tmp, str(FP_JSONL))

rows2 = [json.loads(l) for l in FP_JSONL.read_text().strip().split('\n') if l.strip()]
excluded = {'code-quality/deterministic/unsafe-any-usage'}
fps2 = [r for r in rows2 if r.get('class') == 'FP' and r.get('rule') not in excluded]
from collections import Counter
print('\nFinal non-excluded status:')
for s,c in Counter(r.get('status') for r in fps2).most_common():
    print(f'  {s}: {c}')

# Count fp-shapes-recovered still in use
still = 0
for fname in os.listdir(SCRATCH_DIR):
    if not fname.endswith('.json'): continue
    try: dd = json.loads((SCRATCH_DIR/fname).read_text())
    except: continue
    if 'error' in dd: continue
    if dd.get('target_file','').startswith('fp-shapes-recovered/'):
        still += 1
print(f'\nScratches still pointing at fp-shapes-recovered: {still}')
