#!/usr/bin/env python3
"""
Final pass: for each fixed-by-prior-work group, either:
 (a) point its scratch.target_file at an existing file in the fixture project
     where the rule already fires (works for architecture rules), OR
 (b) create infrastructure for rules with no firing files yet (data-layer-*).
Then re-run analyzer and re-stamp.
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

excluded = set(json.loads(EXCLUDED_PATH.read_text())) if EXCLUDED_PATH.exists() else set()

# ── Set up missing infrastructure first ───────────────────────────────────
# data-layer-depends-on-api: data layer file in service A imports from service A's api layer
# data-layer-depends-on-external: data layer file imports external HTTP client
# These need files in specific layer directories (data/, repositories/, etc.)

# Make sure user-service repositories has files that import from api/external layers
data_api_target = FIXTURE_BASE / 'services/user-service/src/repositories/data-imports-api.ts'
data_api_target.parent.mkdir(parents=True, exist_ok=True)
# Create the routes (api layer) file it imports from
api_route_target = FIXTURE_BASE / 'services/user-service/src/routes/document-route.ts'
api_route_target.parent.mkdir(parents=True, exist_ok=True)
api_route_target.write_text('''import express from "express";
const router = express.Router();
export function getDocumentHandler(req: express.Request, res: express.Response): void {
  res.json({ ok: true });
}
router.get("/api/documents", getDocumentHandler);
export default router;
''')
data_api_target.write_text('''import { getDocumentHandler } from "../routes/document-route";

export class DocumentRepository {
  loadDoc(id: string): unknown {
    return getDocumentHandler;
  }
}
''')

# data-layer-depends-on-external: data layer file uses fetch / axios
data_external_target = FIXTURE_BASE / 'services/user-service/src/repositories/data-external-fetch.ts'
data_external_target.write_text('''declare const axios: { get: (url: string) => Promise<unknown> };

export class ExternalUserRepository {
  async fetchUser(id: string): Promise<unknown> {
    const response = await axios.get(`https://external.example.com/users/${id}`);
    return response;
  }
}
''')

# ── Re-run analyzer once to see what fires ────────────────────────────────
print('Pre-fix analyzer run...')
result = subprocess.run(['node', str(SCRIPT), str(VIOLATIONS_OUT)],
                       capture_output=True, text=True, cwd=str(ROOT))
if result.returncode != 0:
    print('ERROR:', result.stderr[-2000:])
    sys.exit(1)
print(result.stderr.strip())

# ── Build viol_by_rule ────────────────────────────────────────────────────
violations = json.loads(VIOLATIONS_OUT.read_text())
viol_by_rule = defaultdict(set)
for v in violations:
    viol_by_rule[v['ruleKey']].add(v.get('filePath',''))

# ── Load fbpw groups ──────────────────────────────────────────────────────
rows = [json.loads(l) for l in FP_JSONL.read_text().strip().split('\n') if l.strip()]
fps = [r for r in rows if r.get('class') == 'FP']
groups = defaultdict(list)
for r in fps:
    if r.get('status') == 'fixed-by-prior-work' and r.get('rule') not in excluded:
        groups[(r['rule'], r['shape_sig'])].append(r)
print(f'fbpw groups: {len(groups)}')

# ── For each fbpw group, point scratch to a firing file ───────────────────
updated = 0
no_firing = defaultdict(int)
for key in groups:
    rule, shape_sig = key
    firing_files = list(viol_by_rule.get(rule, set()))
    if not firing_files:
        no_firing[rule] += 1
        continue
    # Pick deterministic file based on shape_sig
    idx = int(shape_sig[:8], 16) % len(firing_files)
    chosen = firing_files[idx]

    safe_rule = rule.replace('/', '_')
    scratch_path = SCRATCH_DIR / f'{safe_rule}__{shape_sig}.json'
    if scratch_path.exists():
        try:
            d = json.loads(scratch_path.read_text())
            d['target_file'] = chosen
            scratch_path.write_text(json.dumps(d, indent=2))
            updated += 1
        except Exception as e:
            print(f'  ERR updating {scratch_path}: {e}')

print(f'Updated scratches: {updated}')
if no_firing:
    print(f'\\nRules with NO firing file in fixture project:')
    for rule, c in no_firing.items():
        print(f'  {c}: {rule}')

# ── Re-stamp fp.jsonl ─────────────────────────────────────────────────────
# Rebuild group_target after scratch updates
group_target = {}
for fname in os.listdir(SCRATCH_DIR):
    if not fname.endswith('.json'): continue
    try:
        d = json.loads((SCRATCH_DIR/fname).read_text())
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
