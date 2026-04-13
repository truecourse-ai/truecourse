import { describe, it, expect } from 'vitest';
import { checkCodeRules } from '../../packages/analyzer/src/rules/combined-code-checker';
import { ALL_DEFAULT_RULES } from '../../packages/analyzer/src/rules/index';
import { parseCode } from '../../packages/analyzer/src/parser';

const enabledRules = ALL_DEFAULT_RULES.filter((r) => r.enabled);

function check(code: string, filePath = '/test/file.py') {
  const tree = parseCode(code, 'python');
  return checkCodeRules(tree, filePath, code, enabledRules, 'python');
}

// ---------------------------------------------------------------------------
// 1. argument-type-mismatch-python
// ---------------------------------------------------------------------------

describe('FP fix: bugs/deterministic/argument-type-mismatch-python', () => {
  const RULE = 'bugs/deterministic/argument-type-mismatch-python';

  it('does NOT flag correct calls with default params', () => {
    const violations = check(`
def greet(name, greeting="Hello"):
    return f"{greeting}, {name}!"

result = greet("World")
`);
    const matches = violations.filter((v) => v.ruleKey === RULE);
    expect(matches).toHaveLength(0);
  });

  it('does NOT flag correct calls with keyword args', () => {
    const violations = check(`
def connect(host, port, timeout=30):
    pass

connect("localhost", port=8080)
`);
    const matches = violations.filter((v) => v.ruleKey === RULE);
    expect(matches).toHaveLength(0);
  });

  it('does NOT flag calls to methods defined in a class', () => {
    const violations = check(`
class Service:
    def process(self, data, callback=None):
        pass

# Even if called as bare name, we skip method definitions
process("some_data")
`);
    const matches = violations.filter((v) => v.ruleKey === RULE);
    expect(matches).toHaveLength(0);
  });

  it('still flags calls with too few arguments (TP)', () => {
    const violations = check(`
def compute(a, b, c):
    return a + b + c

compute(1)
`);
    const matches = violations.filter((v) => v.ruleKey === RULE);
    expect(matches).toHaveLength(1);
    expect(matches[0].title).toBe('Argument count mismatch');
  });

  it('still flags calls with too many arguments (TP)', () => {
    const violations = check(`
def add(a, b):
    return a + b

add(1, 2, 3)
`);
    const matches = violations.filter((v) => v.ruleKey === RULE);
    expect(matches).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 2. confusing-implicit-concat
// ---------------------------------------------------------------------------

describe('FP fix: bugs/deterministic/confusing-implicit-concat', () => {
  const RULE = 'bugs/deterministic/confusing-implicit-concat';

  it('does NOT flag implicit concat with f-strings', () => {
    const violations = check(`
items = [
    "prefix text "
    f"{variable} more text"
]
`);
    const matches = violations.filter((v) => v.ruleKey === RULE);
    expect(matches).toHaveLength(0);
  });

  it('does NOT flag f-string concat in function args', () => {
    const violations = check(`
print(
    "Hello "
    f"{name}!"
)
`);
    const matches = violations.filter((v) => v.ruleKey === RULE);
    expect(matches).toHaveLength(0);
  });

  it('still flags plain implicit concat in a list (TP)', () => {
    const violations = check(`
items = [
    "first"
    "second"
]
`);
    const matches = violations.filter((v) => v.ruleKey === RULE);
    expect(matches).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 3. fstring-missing-placeholders
// ---------------------------------------------------------------------------

describe('FP fix: bugs/deterministic/fstring-missing-placeholders', () => {
  const RULE = 'bugs/deterministic/fstring-missing-placeholders';

  it('does NOT flag f-string in concat where sibling has placeholders', () => {
    const violations = check(`
msg = (
    f"prefix text "
    f"{variable} more text"
)
`);
    const matches = violations.filter((v) => v.ruleKey === RULE);
    expect(matches).toHaveLength(0);
  });

  it('still flags standalone f-string with no placeholders (TP)', () => {
    const violations = check(`
msg = f"no placeholders here"
`);
    const matches = violations.filter((v) => v.ruleKey === RULE);
    expect(matches).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 4. duplicate-dict-key
// ---------------------------------------------------------------------------

describe('FP fix: bugs/deterministic/duplicate-dict-key', () => {
  const RULE = 'bugs/deterministic/duplicate-dict-key';

  it('does NOT flag dict comprehension with tuple-unpacked loop var as key', () => {
    const violations = check(`
result = {k: v for k, v in items.items()}
`);
    const matches = violations.filter((v) => v.ruleKey === RULE);
    expect(matches).toHaveLength(0);
  });

  it('does NOT flag dict comprehension with simple loop var as key', () => {
    const violations = check(`
result = {x: x * 2 for x in range(10)}
`);
    const matches = violations.filter((v) => v.ruleKey === RULE);
    expect(matches).toHaveLength(0);
  });

  it('still flags dict comprehension with constant string key (TP)', () => {
    const violations = check(`
result = {"key": v for v in items}
`);
    const matches = violations.filter((v) => v.ruleKey === RULE);
    expect(matches).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 5. import-self
// ---------------------------------------------------------------------------

describe('FP fix: bugs/deterministic/import-self', () => {
  const RULE = 'bugs/deterministic/import-self';

  it('does NOT flag importing a top-level package from a nested module with same basename', () => {
    const violations = check(
      `import requests\n`,
      '/project/brain/api/requests.py',
    );
    const matches = violations.filter((v) => v.ruleKey === RULE);
    expect(matches).toHaveLength(0);
  });

  it('does NOT flag from-import of a different top-level package', () => {
    const violations = check(
      `from requests import Session\n`,
      '/project/myapp/requests.py',
    );
    const matches = violations.filter((v) => v.ruleKey === RULE);
    expect(matches).toHaveLength(0);
  });

  it('still flags true self-import at top level (TP)', () => {
    const violations = check(
      `import mymodule\n`,
      '/mymodule.py',
    );
    const matches = violations.filter((v) => v.ruleKey === RULE);
    expect(matches).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 6. implicit-optional
// ---------------------------------------------------------------------------

describe('FP fix: bugs/deterministic/implicit-optional', () => {
  const RULE = 'bugs/deterministic/implicit-optional';

  it('does NOT flag param: Any = None', () => {
    const violations = check(`
def process(data: Any = None):
    pass
`);
    const matches = violations.filter((v) => v.ruleKey === RULE);
    expect(matches).toHaveLength(0);
  });

  it('still flags param: int = None (TP)', () => {
    const violations = check(`
def process(count: int = None):
    pass
`);
    const matches = violations.filter((v) => v.ruleKey === RULE);
    expect(matches).toHaveLength(1);
  });

  it('still skips param: Optional[int] = None', () => {
    const violations = check(`
def process(count: Optional[int] = None):
    pass
`);
    const matches = violations.filter((v) => v.ruleKey === RULE);
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 7. shared-mutable-module-state
// ---------------------------------------------------------------------------

describe('FP fix: bugs/deterministic/shared-mutable-module-state', () => {
  const RULE = 'bugs/deterministic/shared-mutable-module-state';

  it('does NOT flag __all__ = [...]', () => {
    const violations = check(`
__all__ = ["foo", "bar", "baz"]
`);
    const matches = violations.filter((v) => v.ruleKey === RULE);
    expect(matches).toHaveLength(0);
  });

  it('still flags module-level mutable list (TP)', () => {
    const violations = check(`
cache = []
`);
    const matches = violations.filter((v) => v.ruleKey === RULE);
    expect(matches).toHaveLength(1);
  });

  it('still skips ALL_CAPS constants', () => {
    const violations = check(`
DEFAULTS = {"key": "value"}
`);
    const matches = violations.filter((v) => v.ruleKey === RULE);
    expect(matches).toHaveLength(0);
  });
});
