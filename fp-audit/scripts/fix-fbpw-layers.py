#!/usr/bin/env python3
"""
Build proper layer-based fixtures for remaining rules:
- data-layer-depends-on-api
- data-layer-depends-on-external
- orm-lazy-load-in-loop
- missing-unique-constraint
- type-import-side-effects
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

# ── Build proper layer infrastructure ────────────────────────────────────
# Data layer file (in repositories/) that imports an API route file
# AND uses prisma (to ensure data-layer classification).

infra_service = FIXTURE_BASE / 'services/data-layer-tests'

# 1. API layer file (in routes/)
api_route_file = infra_service / 'src/routes/document-api.ts'
api_route_file.parent.mkdir(parents=True, exist_ok=True)
api_route_file.write_text('''import express from "express";
const router = express.Router();
export function getDocument(id: string): Promise<unknown> {
  return Promise.resolve({ id });
}
router.get("/api/documents/:id", (req, res) => {
  res.json({ id: req.params.id });
});
export default router;
''')

# 2. External-using file (under external/ or has fetch import)
external_file = infra_service / 'src/external/payment-client.ts'
external_file.parent.mkdir(parents=True, exist_ok=True)
external_file.write_text('''import axios from "axios";
export async function chargeCard(amount: number): Promise<unknown> {
  return axios.post("https://payments.example.com/charge", { amount });
}
''')

# 3. Data layer file (repositories/) importing both
data_file_to_api = infra_service / 'src/repositories/document-repo-to-api.ts'
data_file_to_api.parent.mkdir(parents=True, exist_ok=True)
data_file_to_api.write_text('''import { PrismaClient } from "@prisma/client";
import { getDocument } from "../routes/document-api";

const prisma = new PrismaClient();
export class DocumentRepository {
  async findById(id: string): Promise<unknown> {
    const local = await prisma.document.findUnique({ where: { id } });
    if (!local) return getDocument(id);
    return local;
  }
}
''')

data_file_to_external = infra_service / 'src/repositories/payment-repo-to-external.ts'
data_file_to_external.write_text('''import { PrismaClient } from "@prisma/client";
import { chargeCard } from "../external/payment-client";

const prisma = new PrismaClient();
export class PaymentRepository {
  async charge(userId: string, amount: number): Promise<unknown> {
    await prisma.payment.create({ data: { userId, amount } });
    return chargeCard(amount);
  }
}
''')

# 4. orm-lazy-load-in-loop — Prisma findUnique inside a for loop
lazy_load_file = FIXTURE_BASE / 'services/api-gateway/src/db/lazy-load-loop.ts'
lazy_load_file.parent.mkdir(parents=True, exist_ok=True)
lazy_load_file.write_text('''import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function loadAllUsers(ids: string[]): Promise<unknown[]> {
  const out: unknown[] = [];
  for (const id of ids) {
    const user = await prisma.user.findUnique({ where: { id } });
    out.push(user);
  }
  return out;
}

export async function loadAllDocs(ids: string[]): Promise<unknown[]> {
  const docs: unknown[] = [];
  for (const id of ids) {
    const d = await prisma.document.findUnique({ where: { id } });
    docs.push(d);
  }
  return docs;
}
''')

# 5. missing-unique-constraint — Prisma schema with non-unique fields
mu_file = FIXTURE_BASE / 'services/api-gateway/src/db/schema-missing-unique.ts'
mu_file.parent.mkdir(parents=True, exist_ok=True)
# Use Drizzle-style schema which the analyzer likely understands
mu_file.write_text('''import { pgTable, varchar, integer } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: integer("id").primaryKey(),
  email: varchar("email", { length: 255 }).notNull(),
  username: varchar("username", { length: 100 }).notNull(),
});

export const accounts = pgTable("accounts", {
  id: integer("id").primaryKey(),
  apiKey: varchar("api_key", { length: 64 }).notNull(),
  externalId: varchar("external_id", { length: 100 }).notNull(),
});
''')

# 6. type-import-side-effects — value import only used as type
side_fx_file = FIXTURE_BASE / 'services/api-gateway/src/types/type-only-import.ts'
side_fx_file.parent.mkdir(parents=True, exist_ok=True)
# A target module
side_fx_target = FIXTURE_BASE / 'services/api-gateway/src/types/some-types.ts'
side_fx_target.write_text('''export interface User {
  id: string;
  name: string;
}
export class UserModel {
  static create(): User { return { id: "", name: "" }; }
}
''')
side_fx_file.write_text('''import { User, UserModel } from "./some-types";
declare const cfg: { user?: User };
export function getName(): string {
  return cfg.user?.name ?? "";
}
''')

# Re-run analyzer
print('Running analyzer...')
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

# Show which rules fire now
target_rules = [
    'architecture/deterministic/data-layer-depends-on-api',
    'architecture/deterministic/data-layer-depends-on-external',
    'database/deterministic/orm-lazy-load-in-loop',
    'database/deterministic/missing-unique-constraint',
    'code-quality/deterministic/type-import-side-effects',
]
for r in target_rules:
    files = viol_by_rule.get(r, set())
    print(f'\n{r}: {len(files)} files')
    for f in sorted(files)[:5]:
        print(f'  {f}')

# ── Point scratches to firing files ───────────────────────────────────────
rows = [json.loads(l) for l in FP_JSONL.read_text().strip().split('\n') if l.strip()]
fps = [r for r in rows if r.get('class') == 'FP']
groups = defaultdict(list)
for r in fps:
    if r.get('status') == 'fixed-by-prior-work' and r.get('rule') not in excluded:
        groups[(r['rule'], r['shape_sig'])].append(r)

updated = 0
for key in groups:
    rule, shape_sig = key
    firing_files = list(viol_by_rule.get(rule, set()))
    if not firing_files:
        continue
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
        except: pass

print(f'\nUpdated scratches: {updated}')

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
print(f'Advanced: {advanced}')

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
