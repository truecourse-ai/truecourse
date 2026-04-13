/**
 * FP fix batch D — tests for 6 Python visitor false-positive fixes.
 *
 * Each rule has:
 *   - A false-positive test (code that should NOT trigger the rule)
 *   - A true-positive test (code that SHOULD trigger the rule)
 */
import { describe, it, expect } from 'vitest';
import { checkCodeRules } from '../../packages/analyzer/src/rules/combined-code-checker';
import { ALL_DEFAULT_RULES } from '../../packages/analyzer/src/rules/index';
import { parseCode } from '../../packages/analyzer/src/parser';

const enabledRules = ALL_DEFAULT_RULES.filter((r) => r.enabled);

function check(code: string) {
  const tree = parseCode(code, 'python');
  return checkCodeRules(tree, '/test/file.py', code, enabledRules, 'python');
}

function violationsFor(code: string, ruleKey: string) {
  return check(code).filter((v) => v.ruleKey === ruleKey);
}

// ---------------------------------------------------------------------------
// 1. redundant-jump
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/redundant-jump (Python FP fix)', () => {
  it('does NOT flag continue that skips meaningful code after it', () => {
    const code = `
for item in items:
    if not item.get("active"):
        continue
    results.append(item["name"])
`;
    expect(violationsFor(code, 'code-quality/deterministic/redundant-jump')).toHaveLength(0);
  });

  it('does NOT flag continue inside an if with code after the if block', () => {
    const code = `
for record in records:
    if record.get("skip"):
        logger.info("skipping")
        continue
    handle_record(record)
`;
    expect(violationsFor(code, 'code-quality/deterministic/redundant-jump')).toHaveLength(0);
  });

  it('flags continue at the very end of a loop body (true positive)', () => {
    const code = `
for item in items:
    handle(item)
    continue
`;
    expect(violationsFor(code, 'code-quality/deterministic/redundant-jump')).toHaveLength(1);
  });

  it('flags bare return at the end of a function (true positive)', () => {
    const code = `
def cleanup():
    logger.info("done")
    return
`;
    expect(violationsFor(code, 'code-quality/deterministic/redundant-jump')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 2. self-first-argument
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/self-first-argument (Python FP fix)', () => {
  it('does NOT flag @staticmethod methods that omit self', () => {
    const code = `
class Helper:
    @staticmethod
    def compute(data):
        return len(data)
`;
    expect(violationsFor(code, 'code-quality/deterministic/self-first-argument')).toHaveLength(0);
  });

  it('does NOT flag @classmethod methods using cls', () => {
    const code = `
class Helper:
    @classmethod
    def from_config(cls, config):
        return cls()
`;
    expect(violationsFor(code, 'code-quality/deterministic/self-first-argument')).toHaveLength(0);
  });

  it('flags instance method with wrong first argument name (true positive)', () => {
    const code = `
class BadService:
    def do_work(this):
        pass
`;
    expect(violationsFor(code, 'code-quality/deterministic/self-first-argument')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 3. aws-custom-polling
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/aws-custom-polling (Python FP fix)', () => {
  it('does NOT flag polling loops in files without AWS SDK import', () => {
    const code = `
import time

def poll_device(device_id):
    while True:
        response = get_device_status(device_id)
        status = response.get("status")
        if status == "ready":
            return response
        time.sleep(5)
`;
    expect(violationsFor(code, 'code-quality/deterministic/aws-custom-polling')).toHaveLength(0);
  });

  it('flags polling loop in file that imports boto3 (true positive)', () => {
    const code = `
import time
import boto3

def wait_for_instance(ec2_client, instance_id):
    while True:
        response = ec2_client.describe_instances(InstanceIds=[instance_id])
        state = response["Reservations"][0]["Instances"][0]["State"]["Name"]
        status = state
        if status == "running":
            break
        time.sleep(10)
`;
    expect(violationsFor(code, 'code-quality/deterministic/aws-custom-polling')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 4. batch-writes-in-loop
// ---------------------------------------------------------------------------

describe('performance/deterministic/batch-writes-in-loop (Python FP fix)', () => {
  it('does NOT flag set.add() in a loop (local collection)', () => {
    const code = `
def collect_ids(items):
    seen = set()
    for item in items:
        seen.add(item["id"])
    return seen
`;
    expect(violationsFor(code, 'performance/deterministic/batch-writes-in-loop')).toHaveLength(0);
  });

  it('does NOT flag dict.update() in a loop (local collection)', () => {
    const code = `
def merge_records(records):
    combined = {}
    for record in records:
        combined.update(record)
    return combined
`;
    expect(violationsFor(code, 'performance/deterministic/batch-writes-in-loop')).toHaveLength(0);
  });

  it('flags session.add() in a loop (true positive — ORM write)', () => {
    const code = `
def save_users(session, users):
    for user in users:
        session.add(user)
`;
    expect(violationsFor(code, 'performance/deterministic/batch-writes-in-loop')).toHaveLength(1);
  });

  it('flags db.insert() in a loop (true positive — ORM write)', () => {
    const code = `
def insert_records(db, records):
    for record in records:
        db.insert(record)
`;
    expect(violationsFor(code, 'performance/deterministic/batch-writes-in-loop')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 5. require-await
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/require-await (Python FP fix)', () => {
  it('does NOT flag FastAPI route handler without await', () => {
    const code = `
from fastapi import APIRouter

router = APIRouter()

@router.get("/health")
async def health():
    return {"status": "ok"}
`;
    expect(violationsFor(code, 'code-quality/deterministic/require-await')).toHaveLength(0);
  });

  it('does NOT flag FastAPI POST handler without await', () => {
    const code = `
from fastapi import APIRouter

router = APIRouter()

@router.post("/items")
async def create_item(name: str):
    return {"name": name}
`;
    expect(violationsFor(code, 'code-quality/deterministic/require-await')).toHaveLength(0);
  });

  it('flags plain async function without await (true positive)', () => {
    const code = `
async def compute_total(items):
    return sum(i.value for i in items)
`;
    expect(violationsFor(code, 'code-quality/deterministic/require-await')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 6. async-unused-async
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/async-unused-async (Python FP fix)', () => {
  it('does NOT flag FastAPI PUT route handler without await', () => {
    const code = `
from fastapi import APIRouter

router = APIRouter()

@router.put("/items/{item_id}")
async def update_item(item_id: int, data: dict):
    return {"item_id": item_id}
`;
    expect(violationsFor(code, 'code-quality/deterministic/async-unused-async')).toHaveLength(0);
  });

  it('does NOT flag FastAPI DELETE route handler without await', () => {
    const code = `
from fastapi import APIRouter

router = APIRouter()

@router.delete("/items/{item_id}")
async def delete_item(item_id: int):
    return {"deleted": item_id}
`;
    expect(violationsFor(code, 'code-quality/deterministic/async-unused-async')).toHaveLength(0);
  });

  it('flags plain async function without await (true positive)', () => {
    const code = `
async def format_name(first, last):
    return f"{first} {last}"
`;
    expect(violationsFor(code, 'code-quality/deterministic/async-unused-async')).toHaveLength(1);
  });
});
