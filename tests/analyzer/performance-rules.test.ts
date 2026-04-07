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

  it('detects arrow function in JSX prop on custom component', () => {
    const code = `const App = () => <MyButton onClick={() => doSomething()}>Click</MyButton>;`;
    const violations = only(check(code, 'tsx'), KEY);
    expect(violations.length).toBeGreaterThanOrEqual(1);
  });

  it('detects .bind() in JSX prop on custom component', () => {
    const code = `const App = () => <MyButton onClick={handler.bind(this)}>Click</MyButton>;`;
    const violations = only(check(code, 'tsx'), KEY);
    expect(violations.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag arrow function on native HTML element', () => {
    const code = `const App = () => <button onClick={() => doSomething()}>Click</button>;`;
    const violations = only(check(code, 'tsx'), KEY);
    expect(violations).toHaveLength(0);
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

// ---------------------------------------------------------------------------
// 11. settimeout-setinterval-no-clear
// ---------------------------------------------------------------------------

describe('performance/deterministic/settimeout-setinterval-no-clear', () => {
  const KEY = 'performance/deterministic/settimeout-setinterval-no-clear';

  it('detects setTimeout without storing reference', () => {
    const code = `setTimeout(() => doSomething(), 1000);`;
    const violations = only(check(code), KEY);
    expect(violations.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag when reference is stored', () => {
    const code = `const timer = setTimeout(() => doSomething(), 1000);`;
    const violations = only(check(code), KEY);
    expect(violations).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 12. unbounded-array-growth
// ---------------------------------------------------------------------------

describe('performance/deterministic/unbounded-array-growth', () => {
  const KEY = 'performance/deterministic/unbounded-array-growth';

  it('detects Array.push in loop without bounds', () => {
    const code = `
for (let i = 0; i < 1000; i++) {
  results.push(compute(i));
}`;
    const violations = only(check(code), KEY);
    expect(violations.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag push outside loop', () => {
    const code = `results.push(item);`;
    const violations = only(check(code), KEY);
    expect(violations).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 13. missing-usememo-expensive
// ---------------------------------------------------------------------------

describe('performance/deterministic/missing-usememo-expensive', () => {
  const KEY = 'performance/deterministic/missing-usememo-expensive';

  it('detects expensive computation in component without useMemo', () => {
    const code = `
function UserList() {
  const sorted = users.sort((a, b) => a.name.localeCompare(b.name));
  return <div>{sorted.map(u => <span key={u.id}>{u.name}</span>)}</div>;
}`;
    const violations = only(check(code, 'tsx'), KEY);
    expect(violations.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag computation inside useMemo', () => {
    const code = `
function UserList() {
  const sorted = useMemo(() => users.sort((a, b) => a.name.localeCompare(b.name)), [users]);
  return <div>{sorted.map(u => <span key={u.id}>{u.name}</span>)}</div>;
}`;
    const violations = only(check(code, 'tsx'), KEY);
    expect(violations).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 14. synchronous-crypto
// ---------------------------------------------------------------------------

describe('performance/deterministic/synchronous-crypto', () => {
  const KEY = 'performance/deterministic/synchronous-crypto';

  it('detects pbkdf2Sync in async function', () => {
    const code = `
async function hashPassword(password: string) {
  return crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512');
}`;
    const violations = only(check(code), KEY);
    expect(violations.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag pbkdf2Sync in sync function', () => {
    const code = `
function hashPassword(password: string) {
  return crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512');
}`;
    const violations = only(check(code), KEY);
    expect(violations).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 15. sync-require-in-handler
// ---------------------------------------------------------------------------

describe('performance/deterministic/sync-require-in-handler', () => {
  const KEY = 'performance/deterministic/sync-require-in-handler';

  it('detects require() in async handler', () => {
    const code = `
async function handleRequest() {
  const lib = require('heavy-lib');
  return lib.process();
}`;
    const violations = only(check(code), KEY);
    expect(violations.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag require() at top level', () => {
    const code = `const lib = require('heavy-lib');`;
    const violations = only(check(code), KEY);
    expect(violations).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Python performance rules
// ---------------------------------------------------------------------------

describe('performance/deterministic/quadratic-list-summation', () => {
  const KEY = 'performance/deterministic/quadratic-list-summation';

  it('detects string += in loop', () => {
    const code = `
result = ""
for item in items:
    result += str(item)
`;
    const violations = only(check(code, 'python'), KEY);
    expect(violations.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag += outside loop', () => {
    const code = `result += "hello"`;
    const violations = only(check(code, 'python'), KEY);
    expect(violations).toHaveLength(0);
  });
});

describe('performance/deterministic/str-replace-over-re-sub', () => {
  const KEY = 'performance/deterministic/str-replace-over-re-sub';

  it('detects re.sub with plain string pattern', () => {
    const code = `result = re.sub("hello", "world", text)`;
    const violations = only(check(code, 'python'), KEY);
    expect(violations.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag re.sub with regex pattern', () => {
    const code = `result = re.sub("\\\\d+", "NUM", text)`;
    const violations = only(check(code, 'python'), KEY);
    expect(violations).toHaveLength(0);
  });
});

describe('performance/deterministic/list-comprehension-in-any-all', () => {
  const KEY = 'performance/deterministic/list-comprehension-in-any-all';

  it('detects list comprehension in any()', () => {
    const code = `result = any([x > 0 for x in items])`;
    const violations = only(check(code, 'python'), KEY);
    expect(violations.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag generator expression in any()', () => {
    const code = `result = any(x > 0 for x in items)`;
    const violations = only(check(code, 'python'), KEY);
    expect(violations).toHaveLength(0);
  });
});

describe('performance/deterministic/unnecessary-list-cast', () => {
  const KEY = 'performance/deterministic/unnecessary-list-cast';

  it('detects list() around list comprehension', () => {
    const code = `result = list([x * 2 for x in items])`;
    const violations = only(check(code, 'python'), KEY);
    expect(violations.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag list() around generator', () => {
    const code = `result = list(x * 2 for x in items)`;
    const violations = only(check(code, 'python'), KEY);
    expect(violations).toHaveLength(0);
  });
});

describe('performance/deterministic/try-except-in-loop', () => {
  const KEY = 'performance/deterministic/try-except-in-loop';

  it('detects try/except inside loop', () => {
    const code = `
for item in items:
    try:
        process(item)
    except Exception:
        pass
`;
    const violations = only(check(code, 'python'), KEY);
    expect(violations.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag try/except outside loop', () => {
    const code = `
try:
    process(item)
except Exception:
    pass
`;
    const violations = only(check(code, 'python'), KEY);
    expect(violations).toHaveLength(0);
  });
});

describe('performance/deterministic/manual-list-comprehension', () => {
  const KEY = 'performance/deterministic/manual-list-comprehension';

  it('detects loop with single append', () => {
    const code = `
for item in items:
    result.append(item * 2)
`;
    const violations = only(check(code, 'python'), KEY);
    expect(violations.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag loop with multiple statements', () => {
    const code = `
for item in items:
    processed = transform(item)
    result.append(processed)
`;
    const violations = only(check(code, 'python'), KEY);
    expect(violations).toHaveLength(0);
  });
});

describe('performance/deterministic/torch-dataloader-num-workers', () => {
  const KEY = 'performance/deterministic/torch-dataloader-num-workers';

  it('detects DataLoader with num_workers=0', () => {
    const code = `loader = DataLoader(dataset, batch_size=32, num_workers=0)`;
    const violations = only(check(code, 'python'), KEY);
    expect(violations.length).toBeGreaterThanOrEqual(1);
  });

  it('detects DataLoader without num_workers', () => {
    const code = `loader = DataLoader(dataset, batch_size=32)`;
    const violations = only(check(code, 'python'), KEY);
    expect(violations.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag DataLoader with num_workers > 0', () => {
    const code = `loader = DataLoader(dataset, batch_size=32, num_workers=4)`;
    const violations = only(check(code, 'python'), KEY);
    expect(violations).toHaveLength(0);
  });
});

describe('performance/deterministic/batch-writes-in-loop', () => {
  const KEY = 'performance/deterministic/batch-writes-in-loop';

  it('detects db.save() in loop', () => {
    const code = `
for item in items:
    db.save(item)
`;
    const violations = only(check(code, 'python'), KEY);
    expect(violations.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag db.save() outside loop', () => {
    const code = `db.save(item)`;
    const violations = only(check(code, 'python'), KEY);
    expect(violations).toHaveLength(0);
  });
});

describe('performance/deterministic/runtime-cast-overhead', () => {
  const KEY = 'performance/deterministic/runtime-cast-overhead';

  it('detects int() in loop', () => {
    const code = `
for item in items:
    val = int(item)
`;
    const violations = only(check(code, 'python'), KEY);
    expect(violations.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag int() outside loop', () => {
    const code = `val = int(x)`;
    const violations = only(check(code, 'python'), KEY);
    expect(violations).toHaveLength(0);
  });
});
