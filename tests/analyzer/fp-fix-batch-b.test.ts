/**
 * FP-fix batch B: tests for 7 Python false-positive fixes.
 *
 * For each rule: one test verifies the FP is now skipped (no violation),
 * one test verifies a real TP still fires.
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
// 1. unintentional-type-annotation
// ---------------------------------------------------------------------------

describe('Python FP fix: unintentional-type-annotation', () => {
  const RULE = 'bugs/deterministic/unintentional-type-annotation';

  it('skips forward declaration when variable is assigned later in scope', () => {
    const code = `
def process(mode):
    result: int
    if mode == "sum":
        result = 10
    else:
        result = 20
    return result
`;
    expect(violationsFor(code, RULE)).toHaveLength(0);
  });

  it('skips forward declaration with augmented assignment later', () => {
    const code = `
def compute(data):
    total: int
    total = 0
    for item in data:
        total += item
    return total
`;
    expect(violationsFor(code, RULE)).toHaveLength(0);
  });

  it('still flags bare annotation with no subsequent assignment', () => {
    const code = `
def bad():
    result: int
    return None
`;
    expect(violationsFor(code, RULE)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 2. loop-at-most-one-iteration
// ---------------------------------------------------------------------------

describe('Python FP fix: loop-at-most-one-iteration', () => {
  const RULE = 'bugs/deterministic/loop-at-most-one-iteration';

  it('skips search loop with continue inside if block', () => {
    const code = `
def find_valid(items):
    for item in items:
        if not item.get("valid"):
            continue
        return item
    return None
`;
    expect(violationsFor(code, RULE)).toHaveLength(0);
  });

  it('skips loop with multiple continue branches', () => {
    const code = `
def find_handler(handlers, event_type):
    for handler in handlers:
        if handler.event_type != event_type:
            continue
        if not handler.is_active:
            continue
        return handler
    raise ValueError("No handler")
`;
    expect(violationsFor(code, RULE)).toHaveLength(0);
  });

  it('still flags unconditional return with no continue', () => {
    const code = `
def first(items):
    for item in items:
        return item
`;
    expect(violationsFor(code, RULE)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 3. async-busy-wait
// ---------------------------------------------------------------------------

describe('Python FP fix: async-busy-wait', () => {
  const RULE = 'bugs/deterministic/async-busy-wait';

  it('skips loop with properly awaited asyncio.sleep', () => {
    const code = `
import asyncio

async def poll(check_fn, timeout=30.0):
    elapsed = 0.0
    while elapsed < timeout:
        if await check_fn():
            return True
        await asyncio.sleep(1.0)
        elapsed += 1.0
    return False
`;
    expect(violationsFor(code, RULE)).toHaveLength(0);
  });

  it('skips loop with await sleep in try/except', () => {
    const code = `
import asyncio

async def retry(fn, max_retries=5):
    delay = 1.0
    while max_retries > 0:
        try:
            return await fn()
        except Exception:
            max_retries -= 1
            await asyncio.sleep(delay)
            delay *= 2
    raise RuntimeError("fail")
`;
    expect(violationsFor(code, RULE)).toHaveLength(0);
  });

  it('still flags time.sleep (not awaited) in async loop', () => {
    const code = `
import time

async def busy(check_fn):
    while True:
        if check_fn():
            return True
        time.sleep(1)
`;
    expect(violationsFor(code, RULE)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 4. cancellation-exception-not-reraised
// ---------------------------------------------------------------------------

describe('Python FP fix: cancellation-exception-not-reraised', () => {
  const RULE = 'bugs/deterministic/cancellation-exception-not-reraised';

  it('skips when enclosing function calls .cancel() on a task', () => {
    const code = `
import asyncio

async def cancel_task(task):
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        print("cancelled")
`;
    expect(violationsFor(code, RULE)).toHaveLength(0);
  });

  it('still flags swallowed CancelledError without .cancel() in scope', () => {
    const code = `
import asyncio

async def swallow():
    try:
        await asyncio.sleep(10)
    except asyncio.CancelledError:
        print("swallowed")
`;
    expect(violationsFor(code, RULE)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 5. nonlocal-without-binding
// ---------------------------------------------------------------------------

describe('Python FP fix: nonlocal-without-binding', () => {
  const RULE = 'bugs/deterministic/nonlocal-without-binding';

  it('skips when variable is defined in enclosing function scope', () => {
    const code = `
def make_counter(start=0):
    count = start
    def increment(n=1):
        nonlocal count
        count += n
        return count
    return increment
`;
    expect(violationsFor(code, RULE)).toHaveLength(0);
  });

  it('skips when variable is assigned inside conditional in enclosing scope', () => {
    const code = `
def outer():
    total = 0
    items = []
    def add(value):
        nonlocal total
        total += value
        items.append(value)
    return add
`;
    expect(violationsFor(code, RULE)).toHaveLength(0);
  });

  it('still flags nonlocal when variable is not in enclosing scope', () => {
    const code = `
def outer():
    def inner():
        nonlocal missing_var
        missing_var = 42
    return inner
`;
    expect(violationsFor(code, RULE)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 6. logging-exception-outside-handler
// ---------------------------------------------------------------------------

describe('Python FP fix: logging-exception-outside-handler', () => {
  const RULE = 'bugs/deterministic/logging-exception-outside-handler';

  it('skips Future.exception() — not a logging call', () => {
    const code = `
import asyncio

async def check_task(task):
    exc = task.exception()
    if exc is not None:
        print(exc)
`;
    expect(violationsFor(code, RULE)).toHaveLength(0);
  });

  it('skips retry_state.outcome.exception() — not a logging call', () => {
    const code = `
def on_retry(retry_state):
    exc = retry_state.outcome.exception()
    if exc:
        print(f"Retry failed: {exc}")
`;
    expect(violationsFor(code, RULE)).toHaveLength(0);
  });

  it('still flags logger.exception() outside except block', () => {
    const code = `
import logging
logger = logging.getLogger(__name__)

def process(data):
    logger.exception("Something went wrong")
    return data
`;
    expect(violationsFor(code, RULE)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 7. missing-fstring-syntax
// ---------------------------------------------------------------------------

describe('Python FP fix: missing-fstring-syntax', () => {
  const RULE = 'bugs/deterministic/missing-fstring-syntax';

  it('skips Jinja/Mustache template strings with {{}}', () => {
    const code = `
TEMPLATE = "Hello {{name}}, welcome to {{site}}"
`;
    expect(violationsFor(code, RULE)).toHaveLength(0);
  });

  it('skips docstrings describing API paths', () => {
    const code = `
def get_user(user_id):
    """Fetch user by ID.

    GET /api/users/{user_id}
    Returns the user object.
    """
    pass
`;
    expect(violationsFor(code, RULE)).toHaveLength(0);
  });

  it('skips format-spec placeholders like {0} and {name!r}', () => {
    const code = `
FMT_POS = "Hello {0}, you have {1} messages"
FMT_CONV = "Value is {name!r} with {count!s}"
FMT_SPEC = "Price: {price:.2f}"
`;
    expect(violationsFor(code, RULE)).toHaveLength(0);
  });

  it('still flags actual missing f-prefix', () => {
    const code = `
def greet(name):
    return "Hello {name}, welcome!"
`;
    expect(violationsFor(code, RULE)).toHaveLength(1);
  });
});
