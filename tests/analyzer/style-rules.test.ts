import { describe, it, expect } from 'vitest';
import { checkCodeRules } from '../../packages/analyzer/src/rules/combined-code-checker';
import { ALL_DEFAULT_RULES } from '../../packages/analyzer/src/rules/index';
import { parseCode } from '../../packages/analyzer/src/parser';

const enabledRules = ALL_DEFAULT_RULES.filter((r) => r.enabled);

function check(code: string, language: 'typescript' | 'tsx' | 'javascript' | 'python' = 'typescript', filePath?: string) {
  const extMap: Record<string, string> = { python: '.py', tsx: '.tsx', javascript: '.js' };
  const ext = extMap[language] ?? '.ts';
  const path = filePath ?? `/test/file${ext}`;
  const tree = parseCode(code, language);
  return checkCodeRules(tree, path, code, enabledRules, language);
}

function only(violations: ReturnType<typeof check>, ruleKey: string) {
  return violations.filter((v) => v.ruleKey === ruleKey);
}

// ===========================================================================
// import-formatting (JS)
// ===========================================================================

describe('style/deterministic/import-formatting (JS)', () => {
  const KEY = 'style/deterministic/import-formatting';

  it('detects import after non-import code', () => {
    const code = `
const x = 1;
import { foo } from 'bar';
`;
    const violations = only(check(code), KEY);
    expect(violations.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag imports at top of file', () => {
    const code = `
import { foo } from 'bar';
import { baz } from 'qux';
const x = 1;
`;
    const violations = only(check(code), KEY);
    expect(violations).toHaveLength(0);
  });
});

// ===========================================================================
// comment-tag-formatting
// ===========================================================================

describe('style/deterministic/comment-tag-formatting', () => {
  const KEY = 'style/deterministic/comment-tag-formatting';

  it('detects TODO without colon', () => {
    const code = `// TODO fix this bug`;
    const violations = only(check(code), KEY);
    expect(violations.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag properly formatted TODO', () => {
    const code = `// TODO: fix this bug`;
    const violations = only(check(code), KEY);
    expect(violations).toHaveLength(0);
  });
});

// ===========================================================================
// js-style-preference — var usage
// ===========================================================================

describe('style/deterministic/js-style-preference', () => {
  const KEY = 'style/deterministic/js-style-preference';

  it('detects var usage', () => {
    const code = `var x = 1;`;
    const violations = only(check(code, 'javascript'), KEY);
    expect(violations.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag const/let', () => {
    const code = `const x = 1; let y = 2;`;
    const violations = only(check(code), KEY);
    expect(violations).toHaveLength(0);
  });
});

// ===========================================================================
// ts-declaration-style — empty interface
// ===========================================================================

describe('style/deterministic/ts-declaration-style', () => {
  const KEY = 'style/deterministic/ts-declaration-style';

  it('detects empty interface', () => {
    const code = `interface Empty {}`;
    const violations = only(check(code), KEY);
    expect(violations.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag interface with members', () => {
    const code = `interface User { name: string; }`;
    const violations = only(check(code), KEY);
    expect(violations).toHaveLength(0);
  });
});

// ===========================================================================
// sorting-style — unsorted named imports
// ===========================================================================

describe('style/deterministic/sorting-style', () => {
  const KEY = 'style/deterministic/sorting-style';

  it('detects unsorted named imports', () => {
    const code = `import { z, a, m } from 'lib';`;
    const violations = only(check(code), KEY);
    expect(violations.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag sorted named imports', () => {
    const code = `import { a, m, z } from 'lib';`;
    const violations = only(check(code), KEY);
    expect(violations).toHaveLength(0);
  });
});

// ===========================================================================
// js-naming-convention — snake_case in JS
// ===========================================================================

describe('style/deterministic/js-naming-convention', () => {
  const KEY = 'style/deterministic/js-naming-convention';

  it('detects snake_case function in JS', () => {
    const code = `function my_function() { return 1; }`;
    const violations = only(check(code), KEY);
    expect(violations.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag camelCase function', () => {
    const code = `function myFunction() { return 1; }`;
    const violations = only(check(code), KEY);
    expect(violations).toHaveLength(0);
  });
});

// ===========================================================================
// Python style rules
// ===========================================================================

describe('style/deterministic/import-formatting (Python)', () => {
  const KEY = 'style/deterministic/import-formatting';

  it('detects import after code in Python', () => {
    const code = `
x = 1
import os
`;
    const violations = only(check(code, 'python'), KEY);
    expect(violations.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag imports at top in Python', () => {
    const code = `
import os
import sys
x = 1
`;
    const violations = only(check(code, 'python'), KEY);
    expect(violations).toHaveLength(0);
  });
});

describe('style/deterministic/comment-tag-formatting (Python)', () => {
  const KEY = 'style/deterministic/comment-tag-formatting';

  it('detects TODO without colon in Python', () => {
    const code = `# TODO fix this`;
    const violations = only(check(code, 'python'), KEY);
    expect(violations.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag properly formatted TODO', () => {
    const code = `# TODO: fix this`;
    const violations = only(check(code, 'python'), KEY);
    expect(violations).toHaveLength(0);
  });
});

describe('style/deterministic/python-naming-convention', () => {
  const KEY = 'style/deterministic/python-naming-convention';

  it('detects camelCase function in Python', () => {
    const code = `
def myFunction():
    pass
`;
    const violations = only(check(code, 'python'), KEY);
    expect(violations.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag snake_case function', () => {
    const code = `
def my_function():
    pass
`;
    const violations = only(check(code, 'python'), KEY);
    expect(violations).toHaveLength(0);
  });
});

describe('style/deterministic/docstring-completeness', () => {
  const KEY = 'style/deterministic/docstring-completeness';

  it('detects public function without docstring', () => {
    const code = `
def process_data(items):
    return [x * 2 for x in items]
`;
    const violations = only(check(code, 'python'), KEY);
    expect(violations.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag function with docstring', () => {
    const code = `
def process_data(items):
    """Process the data items."""
    return [x * 2 for x in items]
`;
    const violations = only(check(code, 'python'), KEY);
    expect(violations).toHaveLength(0);
  });

  it('does not flag private function', () => {
    const code = `
def _internal_helper():
    return 42
`;
    const violations = only(check(code, 'python'), KEY);
    expect(violations).toHaveLength(0);
  });
});
