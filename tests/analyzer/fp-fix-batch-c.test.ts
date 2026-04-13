/**
 * FP fix batch C — false positive fixes for 6 Python code-quality rules.
 *
 * For each rule: one test for the FP skip (no violation), one test for a real TP (violation detected).
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
// 1. subclass-builtin-collection
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/subclass-builtin-collection — Enum mixin FP fix', () => {
  it('does NOT flag class(str, enum.Enum) — standard string enum pattern', () => {
    const code = `
import enum

class Color(str, enum.Enum):
    RED = "red"
    GREEN = "green"
`;
    const v = violationsFor(code, 'code-quality/deterministic/subclass-builtin-collection');
    expect(v).toHaveLength(0);
  });

  it('does NOT flag class(int, Enum) — integer enum pattern', () => {
    const code = `
from enum import Enum

class Status(int, Enum):
    ACTIVE = 1
    DISABLED = 2
`;
    const v = violationsFor(code, 'code-quality/deterministic/subclass-builtin-collection');
    expect(v).toHaveLength(0);
  });

  it('still flags class(dict) without Enum — real TP', () => {
    const code = `
class MyDict(dict):
    pass
`;
    const v = violationsFor(code, 'code-quality/deterministic/subclass-builtin-collection');
    expect(v).toHaveLength(1);
    expect(v[0].title).toContain('dict');
  });

  it('still flags class(list) without Enum — real TP', () => {
    const code = `
class MyList(list):
    pass
`;
    const v = violationsFor(code, 'code-quality/deterministic/subclass-builtin-collection');
    expect(v).toHaveLength(1);
    expect(v[0].title).toContain('list');
  });
});

// ---------------------------------------------------------------------------
// 2. boolean-trap
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/boolean-trap — getattr/Field FP fix', () => {
  it('does NOT flag getattr(args, "flag", False)', () => {
    const code = `
verbose = getattr(args, "verbose", False)
`;
    const v = violationsFor(code, 'code-quality/deterministic/boolean-trap');
    expect(v).toHaveLength(0);
  });

  it('does NOT flag hasattr(obj, "name")', () => {
    const code = `
result = hasattr(obj, "name")
`;
    const v = violationsFor(code, 'code-quality/deterministic/boolean-trap');
    expect(v).toHaveLength(0);
  });

  it('does NOT flag setattr(obj, "active", True)', () => {
    const code = `
setattr(obj, "active", True)
`;
    const v = violationsFor(code, 'code-quality/deterministic/boolean-trap');
    expect(v).toHaveLength(0);
  });

  it('does NOT flag Field(False, description="...")', () => {
    const code = `
enabled = Field(False, description="feature toggle")
`;
    const v = violationsFor(code, 'code-quality/deterministic/boolean-trap');
    expect(v).toHaveLength(0);
  });

  it('still flags custom_func(True) — real TP', () => {
    const code = `
launch(True, config)
`;
    const v = violationsFor(code, 'code-quality/deterministic/boolean-trap');
    expect(v).toHaveLength(1);
    expect(v[0].title).toBe('Boolean positional argument');
  });
});

// ---------------------------------------------------------------------------
// 3. redeclared-assigned-name
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/redeclared-assigned-name — transform/init-before-try FP fix', () => {
  it('does NOT flag x = x.strip() — sequential transform', () => {
    const code = `
value = raw_input
value = value.strip()
value = value.lower()
`;
    const v = violationsFor(code, 'code-quality/deterministic/redeclared-assigned-name');
    expect(v).toHaveLength(0);
  });

  it('does NOT flag init-before-try pattern', () => {
    const code = `
result = None
try:
    result = compute()
except Exception:
    result = 0
`;
    const v = violationsFor(code, 'code-quality/deterministic/redeclared-assigned-name');
    expect(v).toHaveLength(0);
  });

  it('still flags x = 1; x = 2 — real TP (no use between assignments)', () => {
    const code = `
x = compute_a()
x = compute_b()
`;
    const v = violationsFor(code, 'code-quality/deterministic/redeclared-assigned-name');
    expect(v).toHaveLength(1);
    expect(v[0].title).toBe('Variable redeclared without use');
  });
});

// ---------------------------------------------------------------------------
// 4. type-check-without-type-error
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/type-check-without-type-error — ValueError/HTTPException FP fix', () => {
  it('does NOT flag isinstance check raising ValueError', () => {
    const code = `
def validate(data):
    if not isinstance(data, dict):
        raise ValueError("Expected a dict")
    return data
`;
    const v = violationsFor(code, 'code-quality/deterministic/type-check-without-type-error');
    expect(v).toHaveLength(0);
  });

  it('does NOT flag isinstance check raising HTTPException', () => {
    const code = `
def validate_body(body):
    if not isinstance(body, str):
        raise HTTPException(status_code=400, detail="Body must be a string")
    return body
`;
    const v = violationsFor(code, 'code-quality/deterministic/type-check-without-type-error');
    expect(v).toHaveLength(0);
  });

  it('still flags isinstance check raising RuntimeError — real TP', () => {
    const code = `
def check_input(value):
    if not isinstance(value, int):
        raise RuntimeError("Expected int")
    return value
`;
    const v = violationsFor(code, 'code-quality/deterministic/type-check-without-type-error');
    expect(v).toHaveLength(1);
    expect(v[0].title).toBe('Type check without TypeError');
  });
});

// ---------------------------------------------------------------------------
// 5. typing-only-import
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/typing-only-import — function signature FP fix', () => {
  it('does NOT flag Optional used in function return type', () => {
    const code = `
from typing import Optional

def find_user(user_id: int) -> Optional[str]:
    if user_id == 0:
        return None
    return "user"
`;
    const v = violationsFor(code, 'code-quality/deterministic/typing-only-import');
    expect(v).toHaveLength(0);
  });

  it('does NOT flag List used in function parameter type', () => {
    const code = `
from typing import List

def process(items: List[int]) -> int:
    return sum(items)
`;
    const v = violationsFor(code, 'code-quality/deterministic/typing-only-import');
    expect(v).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 6. future-annotations-import
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/future-annotations-import — PEP 604/585 FP fix', () => {
  it('does NOT flag file using PEP 585 lowercase generics', () => {
    const code = `
def process(items: list[int]) -> dict[str, int]:
    return {str(i): i for i in items}
`;
    const v = violationsFor(code, 'code-quality/deterministic/future-annotations-import');
    expect(v).toHaveLength(0);
  });

  it('does NOT flag file using PEP 604 union syntax alongside PEP 585', () => {
    const code = `
def process(value: int | str) -> list[str]:
    return [str(value)]
`;
    const v = violationsFor(code, 'code-quality/deterministic/future-annotations-import');
    expect(v).toHaveLength(0);
  });

  it('still flags PEP 604 union syntax in pre-3.10 file (no lowercase generics) — real TP', () => {
    const code = `
from typing import List

def process(value: List[int]) -> int | None:
    if not value:
        return None
    return value[0]
`;
    const v = violationsFor(code, 'code-quality/deterministic/future-annotations-import');
    expect(v).toHaveLength(1);
    expect(v[0].title).toBe('Future annotations import needed');
  });
});
