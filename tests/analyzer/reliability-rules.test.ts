import { describe, it, expect } from 'vitest';
import { checkCodeRules } from '../../packages/analyzer/src/rules/combined-code-checker';
import { ALL_DEFAULT_RULES } from '../../packages/analyzer/src/rules/index';
import { parseCode } from '../../packages/analyzer/src/parser';

const enabledRules = ALL_DEFAULT_RULES.filter((r) => r.enabled);

function check(code: string, language: 'typescript' | 'javascript' | 'python' = 'typescript', filePath?: string) {
  const ext = language === 'python' ? '.py' : '.ts';
  const path = filePath ?? `/test/file${ext}`;
  const tree = parseCode(code, language);
  return checkCodeRules(tree, path, code, enabledRules, language);
}

// ===========================================================================
// catch-without-error-type
// ===========================================================================

describe('reliability/deterministic/catch-without-error-type', () => {
  const ruleKey = 'reliability/deterministic/catch-without-error-type';

  it('detects catch without type checking', () => {
    const violations = check(`
try {
  doSomething();
} catch (e) {
  console.error(e);
}
`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag catch with instanceof check', () => {
    const violations = check(`
try {
  doSomething();
} catch (e) {
  if (e instanceof TypeError) {
    handleTypeError(e);
  }
}
`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });

  it('does not flag catch with typeof check', () => {
    const violations = check(`
try {
  doSomething();
} catch (e) {
  if (typeof e === 'string') {
    handleString(e);
  }
}
`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// promise-all-no-error-handling
// ===========================================================================

describe('reliability/deterministic/promise-all-no-error-handling', () => {
  const ruleKey = 'reliability/deterministic/promise-all-no-error-handling';

  it('detects Promise.all without catch', () => {
    const violations = check(`const results = Promise.all([p1, p2]);`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag Promise.all with .catch()', () => {
    const violations = check(`const results = Promise.all([p1, p2]).catch(handleError);`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });

  it('does not flag Promise.all inside try/catch', () => {
    const violations = check(`
try {
  const results = await Promise.all([p1, p2]);
} catch (e) {
  handleError(e);
}
`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// missing-finally-cleanup
// ===========================================================================

describe('reliability/deterministic/missing-finally-cleanup', () => {
  const ruleKey = 'reliability/deterministic/missing-finally-cleanup';

  it('detects try with resource open but no finally', () => {
    const violations = check(`
try {
  const conn = await db.createConnection();
  await conn.query("SELECT 1");
} catch (e) {
  console.error(e);
}
`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag try with finally', () => {
    const violations = check(`
try {
  const conn = await db.createConnection();
  await conn.query("SELECT 1");
} catch (e) {
  console.error(e);
} finally {
  conn.close();
}
`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// unsafe-json-parse
// ===========================================================================

describe('reliability/deterministic/unsafe-json-parse', () => {
  const ruleKey = 'reliability/deterministic/unsafe-json-parse';

  it('detects JSON.parse without try/catch in JS', () => {
    const violations = check(`const data = JSON.parse(input);`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag JSON.parse inside try/catch', () => {
    const violations = check(`
try {
  const data = JSON.parse(input);
} catch (e) {
  console.error(e);
}
`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });

  it('detects json.loads without try/except in Python', () => {
    const violations = check(`data = json.loads(raw)`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag json.loads inside try/except in Python', () => {
    const violations = check(`
try:
    data = json.loads(raw)
except json.JSONDecodeError:
    pass
`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// http-call-no-timeout
// ===========================================================================

describe('reliability/deterministic/http-call-no-timeout', () => {
  const ruleKey = 'reliability/deterministic/http-call-no-timeout';

  it('detects fetch() without timeout in JS', () => {
    const violations = check(`const res = await fetch("https://api.example.com/data");`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag fetch() with signal', () => {
    const violations = check(`const res = await fetch("https://api.example.com", { signal: AbortSignal.timeout(5000) });`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });

  it('detects axios.get without timeout', () => {
    const violations = check(`const res = await axios.get("https://api.example.com");`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag axios.get with timeout', () => {
    const violations = check(`const res = await axios.get("https://api.example.com", { timeout: 10000 });`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });

  it('detects requests.get without timeout in Python', () => {
    const violations = check(`response = requests.get("https://api.example.com")`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag requests.get with timeout in Python', () => {
    const violations = check(`response = requests.get("https://api.example.com", timeout=30)`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// missing-error-event-handler
// ===========================================================================

describe('reliability/deterministic/missing-error-event-handler', () => {
  const ruleKey = 'reliability/deterministic/missing-error-event-handler';

  it('detects createReadStream without error handler', () => {
    const violations = check(`
const stream = fs.createReadStream("file.txt");
stream.pipe(process.stdout);
`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag createReadStream with error handler', () => {
    const violations = check(`
const stream = fs.createReadStream("file.txt");
stream.on('error', (err) => console.error(err));
stream.pipe(process.stdout);
`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// process-exit-in-library
// ===========================================================================

describe('reliability/deterministic/process-exit-in-library', () => {
  const ruleKey = 'reliability/deterministic/process-exit-in-library';

  it('detects process.exit() in library code', () => {
    const violations = check(`process.exit(1);`, 'typescript', '/src/utils/helper.ts');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag process.exit() in entry point', () => {
    const violations = check(`process.exit(1);`, 'typescript', '/src/index.ts');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });

  it('does not flag process.exit() in server file', () => {
    const violations = check(`process.exit(1);`, 'typescript', '/src/server.ts');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });

  it('detects sys.exit() in Python library code', () => {
    const violations = check(`sys.exit(1)`, 'python', '/src/utils/helper.py');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag sys.exit() with __main__ guard in Python', () => {
    const violations = check(`
if __name__ == "__main__":
    sys.exit(0)
`, 'python', '/src/utils/helper.py');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// unchecked-array-access
// ===========================================================================

describe('reliability/deterministic/unchecked-array-access', () => {
  const ruleKey = 'reliability/deterministic/unchecked-array-access';

  it('detects array[i] without bounds check', () => {
    const violations = check(`const item = items[i];`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag array[0] (literal index)', () => {
    const violations = check(`const first = items[0];`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });

  it('does not flag when length check precedes access', () => {
    const violations = check(`
if (i < items.length) {
  const item = items[i];
}
`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });

  it('does not flag arr[arr.length - 1]', () => {
    const violations = check(`const last = arr[arr.length - 1];`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// missing-null-check-after-find
// ===========================================================================

describe('reliability/deterministic/missing-null-check-after-find', () => {
  const ruleKey = 'reliability/deterministic/missing-null-check-after-find';

  it('detects .find().property access', () => {
    const violations = check(`const name = users.find(u => u.id === 1).name;`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag when find result is stored in variable', () => {
    const violations = check(`const user = users.find(u => u.id === 1);`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// floating-promise
// ===========================================================================

describe('reliability/deterministic/floating-promise', () => {
  const ruleKey = 'reliability/deterministic/floating-promise';

  it('detects floating fetch call', () => {
    const violations = check(`fetchData();`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag awaited call', () => {
    const violations = check(`await fetchData();`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });

  it('does not flag call with .catch()', () => {
    const violations = check(`fetchData().catch(handleError);`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });

  it('does not flag non-async-looking function calls', () => {
    const violations = check(`console.log("hello");`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// express-async-no-wrapper
// ===========================================================================

describe('reliability/deterministic/express-async-no-wrapper', () => {
  const ruleKey = 'reliability/deterministic/express-async-no-wrapper';

  it('detects async handler without try/catch', () => {
    const violations = check(`
app.get("/users", async (req, res) => {
  const users = await db.query("SELECT * FROM users");
  res.json(users);
});
`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag async handler with try/catch', () => {
    const violations = check(`
app.get("/users", async (req, res) => {
  try {
    const users = await db.query("SELECT * FROM users");
    res.json(users);
  } catch (e) {
    res.status(500).send("Error");
  }
});
`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });

  it('does not flag non-async handler', () => {
    const violations = check(`
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});
`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// missing-next-on-error
// ===========================================================================

describe('reliability/deterministic/missing-next-on-error', () => {
  const ruleKey = 'reliability/deterministic/missing-next-on-error';

  it('detects catch without next(error) in middleware', () => {
    const violations = check(`
const handler = async (req, res, next) => {
  try {
    await doSomething();
  } catch (e) {
    console.error(e);
  }
};
`, 'typescript', '/src/middleware/auth.ts');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag catch with next(error)', () => {
    const violations = check(`
const handler = async (req, res, next) => {
  try {
    await doSomething();
  } catch (e) {
    next(e);
  }
};
`, 'typescript', '/src/middleware/auth.ts');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// uncaught-exception-no-handler
// ===========================================================================

describe('reliability/deterministic/uncaught-exception-no-handler', () => {
  const ruleKey = 'reliability/deterministic/uncaught-exception-no-handler';

  it('detects missing uncaughtException handler in entry point', () => {
    const violations = check(`
import express from "express";
const app = express();
app.listen(3000);
`, 'typescript', '/src/server.ts');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag when handler is registered', () => {
    const violations = check(`
import express from "express";
const app = express();
process.on('uncaughtException', (err) => { console.error(err); });
app.listen(3000);
`, 'typescript', '/src/server.ts');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });

  it('does not flag non-entry-point files', () => {
    const violations = check(`
const x = 1;
`, 'typescript', '/src/utils/helper.ts');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// empty-reject
// ===========================================================================

describe('reliability/deterministic/empty-reject', () => {
  const ruleKey = 'reliability/deterministic/empty-reject';

  it('detects Promise.reject() without argument', () => {
    const violations = check(`const p = Promise.reject();`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag Promise.reject(new Error("msg"))', () => {
    const violations = check(`const p = Promise.reject(new Error("something went wrong"));`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });

  it('detects empty reject() inside Promise constructor', () => {
    const violations = check(`
const p = new Promise((resolve, reject) => {
  reject();
});
`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag reject(error) inside Promise constructor', () => {
    const violations = check(`
const p = new Promise((resolve, reject) => {
  reject(new Error("fail"));
});
`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// unhandled-rejection-no-handler
// ===========================================================================

describe('reliability/deterministic/unhandled-rejection-no-handler', () => {
  const ruleKey = 'reliability/deterministic/unhandled-rejection-no-handler';

  it('detects missing unhandledRejection handler in entry point', () => {
    const violations = check(`
import express from "express";
const app = express();
app.listen(3000);
`, 'typescript', '/src/server.ts');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag when handler is registered', () => {
    const violations = check(`
import express from "express";
const app = express();
process.on('unhandledRejection', (reason) => { console.error(reason); });
app.listen(3000);
`, 'typescript', '/src/server.ts');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });

  it('does not flag non-entry-point files', () => {
    const violations = check(`
const x = 1;
`, 'typescript', '/src/utils/helper.ts');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});
