#!/usr/bin/env python3
"""
Build per-scratch dispatch units for the 363 copy-pasted fbpw scratches.
Each unit becomes input for one sub-agent that writes a natural fresh snippet.
"""
import os, json
from pathlib import Path

ROOT = Path(__file__).parent.parent.parent
SCRATCH_DIR = ROOT / 'fp-audit/state/positive-scratch'
REWORK_LIST = ROOT / 'fp-audit/state/rework-list.json'
FP_BY_GROUP = ROOT / 'fp-audit/state/fp-by-group.json'
OUT = ROOT / 'fp-audit/state/rework-dispatch.json'

rework_files = json.loads(REWORK_LIST.read_text())
fp_by_group = json.loads(FP_BY_GROUP.read_text())

units = []
for fname in rework_files:
    sp = SCRATCH_DIR / fname
    if not sp.exists(): continue
    try:
        d = json.loads(sp.read_text())
    except: continue
    rule = d.get('rule', '')
    shape_sig = d.get('shape_sig', '')
    key = f'{rule}::{shape_sig}'
    fp_info = fp_by_group.get(key, {})
    if not fp_info: continue
    units.append({
        'scratch_file': fname,
        'rule': rule,
        'shape_sig': shape_sig,
        'representative_fp': fp_info,
        'current_target': d.get('target_file', ''),
        'member_fp_ids': d.get('member_fp_ids', []),
    })

OUT.write_text(json.dumps(units, indent=2))
print(f'Wrote {len(units)} dispatch units to {OUT}')

# Group by rule for batch dispatching
from collections import defaultdict
by_rule = defaultdict(int)
for u in units:
    by_rule[u['rule']] += 1
print('\\nBy rule:')
for r, c in sorted(by_rule.items(), key=lambda x: -x[1]):
    print(f'  {c:4d}  {r}')
