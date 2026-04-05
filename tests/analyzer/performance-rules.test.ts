import { describe, it, expect } from 'vitest';
import { checkCodeRules } from '../../packages/analyzer/src/rules/combined-code-checker';
import { ALL_DEFAULT_RULES } from '../../packages/analyzer/src/rules/index';
import { parseCode } from '../../packages/analyzer/src/parser';

const enabledRules = ALL_DEFAULT_RULES.filter((r) => r.enabled);

function check(code: string, language: 'typescript' | 'tsx' | 'javascript' | 'python' = 'typescript') {
  const extMap: Record<string, string> = { python: '.py', tsx: '.tsx', javascript: '.js' };
  const ext = extMap[language] ?? '.ts';
  const tree = parseCode(code, language);
  return checkCodeRules(tree, `/test/file${ext}`, code, enabledRules, language);
}

function only(violations: ReturnType<typeof check>, ruleKey: string) {
  return violations.filter((v) => v.ruleKey === ruleKey);
}

// ---------------------------------------------------------------------------
// 1. inline-function-in-jsx-prop
// ---------------------------------------------------------------------------

describe('performance/deterministic/inline-function-in-jsx-prop', () => {
  const KEY = 'performance/deterministic/inline-function-in-jsx-prop';

  it('detects arrow function in JSX prop', () => {
    const code = `const App = () => <button onClick={() => doSomething()}>Click</button>;`;
    const violations = only(check(code, 'tsx'), KEY);
    expect(violations.length).toBeGreaterThanOrEqual(1);
  });

  it('detects .bind() in JSX prop', () => {
    const code = `const App = () => <button onClick={handler.bind(this)}>Click</button>;`;
    const violations = only(check(code, 'tsx'), KEY);
    expect(violations.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag variable reference in JSX prop', () => {
    const code = `const App = () => <button onClick={handleClick}>Click</button>;`;
    const violations = only(check(code, 'tsx'), KEY);
    expect(violations).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 2. inline-object-in-jsx-prop
// ---------------------------------------------------------------------------

describe('performance/deterministic/inline-object-in-jsx-prop', () => {
  const KEY = 'performance/deterministic/inline-object-in-jsx-prop';

  it('detects inline object literal in JSX prop', () => {
    const code = `const App = () => <div style={{ color: 'red' }}>Hello</div>;`;
    const violations = only(check(code, 'tsx'), KEY);
    expect(violations.length).toBeGreaterThanOrEqual(1);
  });

  it('detects inline array literal in JSX prop', () => {
    const code = `const App = () => <Select options={[1, 2, 3]} />;`;
    const violations = only(check(code, 'tsx'), KEY);
    expect(violations.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag variable reference in JSX prop', () => {
    const code = `const App = () => <div style={myStyle}>Hello</div>;`;
    const violations = only(check(code, 'tsx'), KEY);
    expect(violations).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 3. regex-in-loop
// ---------------------------------------------------------------------------

describe('performance/deterministic/regex-in-loop', () => {
  const KEY = 'performance/deterministic/regex-in-loop';

  it('detects new RegExp inside for loop', () => {
    const code = `
for (let i = 0; i < items.length; i++) {
  const re = new RegExp(items[i]);
  re.test(str);
}`;
    const violations = only(check(code), KEY);
    expect(violations.length).toBeGreaterThanOrEqual(1);
  });

  it('detects regex literal inside while loop', () => {
    const code = `
while (hasMore) {
  const match = /pattern/.test(input);
  hasMore = false;
}`;
    const violations = only(check(code), KEY);
    expect(violations.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag regex outside of loop', () => {
    const code = `const re = new RegExp('test'); re.test(str);`;
    const violations = only(check(code), KEY);
    expect(violations).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 4. spread-in-reduce
// ---------------------------------------------------------------------------

describe('performance/deterministic/spread-in-reduce', () => {
  const KEY = 'performance/deterministic/spread-in-reduce';

  it('detects spread in reduce callback', () => {
    const code = `const result = arr.reduce((acc, x) => ({ ...acc, [x]: true }), {});`;
    const violations = only(check(code), KEY);
    expect(violations.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag reduce without spread', () => {
    const code = `const result = arr.reduce((acc, x) => { acc[x] = true; return acc; }, {});`;
    const violations = only(check(code), KEY);
    expect(violations).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 5. sync-fs-in-request-handler
// ---------------------------------------------------------------------------

describe('performance/deterministic/sync-fs-in-request-handler', () => {
  const KEY = 'performance/deterministic/sync-fs-in-request-handler';

  it('detects readFileSync in async function', () => {
    const code = `
async function loadData() {
  const data = fs.readFileSync('file.txt');
  return data;
}`;
    const violations = only(check(code), KEY);
    expect(violations.length).toBeGreaterThanOrEqual(1);
  });

  it('detects writeFileSync in Express handler', () => {
    const code = `
function handler(req, res) {
  fs.writeFileSync('log.txt', 'data');
  res.send('ok');
}`;
    const violations = only(check(code), KEY);
    expect(violations.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag sync fs in regular function', () => {
    const code = `
function loadConfig() {
  return fs.readFileSync('config.json');
}`;
    const violations = only(check(code), KEY);
    expect(violations).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 6. missing-cleanup-useeffect
// ---------------------------------------------------------------------------

describe('performance/deterministic/missing-cleanup-useeffect', () => {
  const KEY = 'performance/deterministic/missing-cleanup-useeffect';

  it('detects useEffect with addEventListener but no cleanup', () => {
    const code = `
useEffect(() => {
  window.addEventListener('resize', handler);
}, []);`;
    const violations = only(check(code), KEY);
    expect(violations.length).toBeGreaterThanOrEqual(1);
  });

  it('detects useEffect with setInterval but no cleanup', () => {
    const code = `
useEffect(() => {
  setInterval(() => tick(), 1000);
}, []);`;
    const violations = only(check(code), KEY);
    expect(violations.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag useEffect with cleanup return', () => {
    const code = `
useEffect(() => {
  const id = setInterval(() => tick(), 1000);
  return () => clearInterval(id);
}, []);`;
    const violations = only(check(code), KEY);
    expect(violations).toHaveLength(0);
  });

  it('does not flag useEffect without subscriptions', () => {
    const code = `
useEffect(() => {
  console.log('mounted');
}, []);`;
    const violations = only(check(code), KEY);
    expect(violations).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 7. event-listener-no-remove
// ---------------------------------------------------------------------------

describe('performance/deterministic/event-listener-no-remove', () => {
  const KEY = 'performance/deterministic/event-listener-no-remove';

  it('detects addEventListener without removeEventListener', () => {
    const code = `
function setup() {
  window.addEventListener('click', handler);
}`;
    const violations = only(check(code), KEY);
    expect(violations.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag when removeEventListener is present', () => {
    const code = `
function setup() {
  window.addEventListener('click', handler);
  return () => window.removeEventListener('click', handler);
}`;
    const violations = only(check(code), KEY);
    expect(violations).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 8. large-bundle-import
// ---------------------------------------------------------------------------

describe('performance/deterministic/large-bundle-import', () => {
  const KEY = 'performance/deterministic/large-bundle-import';

  it('detects default import of lodash', () => {
    const code = `import _ from 'lodash';`;
    const violations = only(check(code), KEY);
    expect(violations.length).toBeGreaterThanOrEqual(1);
  });

  it('detects namespace import of moment', () => {
    const code = `import * as moment from 'moment';`;
    const violations = only(check(code), KEY);
    expect(violations.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag subpath import', () => {
    const code = `import get from 'lodash/get';`;
    const violations = only(check(code), KEY);
    expect(violations).toHaveLength(0);
  });

  it('does not flag non-large package', () => {
    const code = `import express from 'express';`;
    const violations = only(check(code), KEY);
    expect(violations).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 9. json-parse-in-loop
// ---------------------------------------------------------------------------

describe('performance/deterministic/json-parse-in-loop', () => {
  const KEY = 'performance/deterministic/json-parse-in-loop';

  it('detects JSON.parse inside for loop', () => {
    const code = `
for (const item of items) {
  const data = JSON.parse(item);
}`;
    const violations = only(check(code), KEY);
    expect(violations.length).toBeGreaterThanOrEqual(1);
  });

  it('detects JSON.stringify inside while loop', () => {
    const code = `
while (queue.length) {
  const str = JSON.stringify(queue.pop());
}`;
    const violations = only(check(code), KEY);
    expect(violations.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag JSON.parse outside loop', () => {
    const code = `const data = JSON.parse(rawStr);`;
    const violations = only(check(code), KEY);
    expect(violations).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 10. state-update-in-loop
// ---------------------------------------------------------------------------

describe('performance/deterministic/state-update-in-loop', () => {
  const KEY = 'performance/deterministic/state-update-in-loop';

  it('detects setState call inside for loop', () => {
    const code = `
for (const item of items) {
  setCount(item.count);
}`;
    const violations = only(check(code), KEY);
    expect(violations.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag setter outside loop', () => {
    const code = `setCount(newCount);`;
    const violations = only(check(code), KEY);
    expect(violations).toHaveLength(0);
  });

  it('does not flag non-setter function in loop', () => {
    const code = `
for (const item of items) {
  processItem(item);
}`;
    const violations = only(check(code), KEY);
    expect(violations).toHaveLength(0);
  });
});
