import { describe, it, expect } from 'vitest';
import { checkCodeRules } from '../../packages/analyzer/src/rules/combined-code-checker';
import { ALL_DEFAULT_RULES } from '../../packages/analyzer/src/rules/index';
import { parseCode } from '../../packages/analyzer/src/parser';

const enabledRules = ALL_DEFAULT_RULES.filter((r) => r.enabled);

function check(code: string, language: 'typescript' | 'javascript' | 'python' = 'typescript') {
  const ext = language === 'python' ? '.py' : '.ts';
  const tree = parseCode(code, language);
  return checkCodeRules(tree, `/test/file${ext}`, code, enabledRules, language);
}

// ---------------------------------------------------------------------------
// JS/TS
// ---------------------------------------------------------------------------

describe('security/deterministic/hardcoded-secret', () => {
  it('detects AWS access key pattern', () => {
    const violations = check(`const key = "AKIAIOSFODNN7EXAMPLE";`);
    const matches = violations.filter((v) => v.ruleKey === 'security/deterministic/hardcoded-secret');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('detects Stripe-like key pattern', () => {
    const violations = check(`const key = "sk_live_abcdefghijklmnop";`);
    const matches = violations.filter((v) => v.ruleKey === 'security/deterministic/hardcoded-secret');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('detects password variable assignment', () => {
    const violations = check(`const password = "supersecret123";`);
    const matches = violations.filter((v) => v.ruleKey === 'security/deterministic/hardcoded-secret');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag short strings', () => {
    const violations = check(`const x = "hello";`);
    const matches = violations.filter((v) => v.ruleKey === 'security/deterministic/hardcoded-secret');
    expect(matches).toHaveLength(0);
  });

  it('does not flag normal strings', () => {
    const violations = check(`const greeting = "Hello, World! Welcome to the app";`);
    const matches = violations.filter((v) => v.ruleKey === 'security/deterministic/hardcoded-secret');
    expect(matches).toHaveLength(0);
  });

  it('does not flag variable names containing uri/url/endpoint', () => {
    const violations = check(`token_uri = "https://oauth2.googleapis.com/token"`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'security/deterministic/hardcoded-secret');
    expect(matches).toHaveLength(0);
  });

  it('does not flag Bearer as a secret value', () => {
    const violations = check(`token_type = "Bearer"`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'security/deterministic/hardcoded-secret');
    expect(matches).toHaveLength(0);
  });
});

describe('security/deterministic/sql-injection', () => {
  it('detects template literal in query()', () => {
    const violations = check('db.query(`SELECT * FROM users WHERE id = ${userId}`);');
    const matches = violations.filter((v) => v.ruleKey === 'security/deterministic/sql-injection');
    expect(matches).toHaveLength(1);
  });

  it('detects string concatenation in query()', () => {
    const violations = check(`db.query("SELECT * FROM users WHERE id = " + userId);`);
    const matches = violations.filter((v) => v.ruleKey === 'security/deterministic/sql-injection');
    expect(matches).toHaveLength(1);
  });

  it('does not flag parameterized queries', () => {
    const violations = check(`db.query("SELECT * FROM users WHERE id = $1", [userId]);`);
    const matches = violations.filter((v) => v.ruleKey === 'security/deterministic/sql-injection');
    expect(matches).toHaveLength(0);
  });

  it('does not flag non-query method calls', () => {
    const violations = check('const x = format(`hello ${name}`);');
    const matches = violations.filter((v) => v.ruleKey === 'security/deterministic/sql-injection');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Python
// ---------------------------------------------------------------------------

describe('Python: security/deterministic/hardcoded-secret', () => {
  it('does not flag dict keys with secret-like names', () => {
    const violations = check(`
config = {
    "token_uri": token_uri,
    "client_secret": client_secret,
    "access_token": creds.token,
}
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'security/deterministic/hardcoded-secret');
    expect(matches).toHaveLength(0);
  });
});

// ===========================================================================
// eval-usage
// ===========================================================================

describe('security/deterministic/eval-usage', () => {
  const ruleKey = 'security/deterministic/eval-usage';

  it('detects eval() in JS', () => {
    const violations = check(`eval(userInput);`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('detects new Function() in JS', () => {
    const violations = check(`const fn = new Function("return " + code);`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('detects setTimeout with string arg', () => {
    const violations = check(`setTimeout("alert(1)", 1000);`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag setTimeout with function arg', () => {
    const violations = check(`setTimeout(() => console.log("ok"), 1000);`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });

  it('detects eval() in Python', () => {
    const violations = check(`result = eval(user_input)`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('detects exec() in Python', () => {
    const violations = check(`exec(code_string)`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('detects compile() in Python', () => {
    const violations = check(`compile(source, "file.py", "exec")`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });
});

// ===========================================================================
// os-command-injection
// ===========================================================================

describe('security/deterministic/os-command-injection', () => {
  const ruleKey = 'security/deterministic/os-command-injection';

  it('detects exec() in JS', () => {
    const violations = check(`const { exec } = require("child_process"); exec(cmd);`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('detects execSync() in JS', () => {
    const violations = check(`execSync("ls -la");`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('detects spawn with shell:true', () => {
    const violations = check(`spawn("cmd", args, { shell: true });`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag spawn without shell:true', () => {
    const violations = check(`spawn("cmd", args);`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });

  it('detects os.system() in Python', () => {
    const violations = check(`os.system("rm -rf /")`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('detects subprocess.run with shell=True in Python', () => {
    const violations = check(`subprocess.run(cmd, shell=True)`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag subprocess.run without shell=True in Python', () => {
    const violations = check(`subprocess.run(["ls", "-la"])`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// weak-hashing
// ===========================================================================

describe('security/deterministic/weak-hashing', () => {
  const ruleKey = 'security/deterministic/weak-hashing';

  it('detects crypto.createHash("md5") in JS', () => {
    const violations = check(`const hash = crypto.createHash("md5");`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('detects crypto.createHash("sha1") in JS', () => {
    const violations = check(`const hash = crypto.createHash('sha1');`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag crypto.createHash("sha256")', () => {
    const violations = check(`const hash = crypto.createHash("sha256");`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });

  it('detects hashlib.md5() in Python', () => {
    const violations = check(`digest = hashlib.md5(data)`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('detects hashlib.sha1() in Python', () => {
    const violations = check(`digest = hashlib.sha1(data)`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag hashlib.sha256() in Python', () => {
    const violations = check(`digest = hashlib.sha256(data)`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// hardcoded-ip
// ===========================================================================

describe('security/deterministic/hardcoded-ip', () => {
  const ruleKey = 'security/deterministic/hardcoded-ip';

  it('detects hardcoded IP address', () => {
    const violations = check(`const host = "192.168.1.100";`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag 127.0.0.1', () => {
    const violations = check(`const host = "127.0.0.1";`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });

  it('does not flag 0.0.0.0', () => {
    const violations = check(`const host = "0.0.0.0";`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });

  it('detects hardcoded IP in Python', () => {
    const violations = check(`host = "10.0.0.1"`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag strings without IPs', () => {
    const violations = check(`const msg = "hello world";`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// clear-text-protocol
// ===========================================================================

describe('security/deterministic/clear-text-protocol', () => {
  const ruleKey = 'security/deterministic/clear-text-protocol';

  it('detects http:// URL', () => {
    const violations = check(`const url = "http://api.example.com/data";`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('detects ftp:// URL', () => {
    const violations = check(`const url = "ftp://files.example.com";`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag http://localhost', () => {
    const violations = check(`const url = "http://localhost:3000";`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });

  it('does not flag http://127.0.0.1', () => {
    const violations = check(`const url = "http://127.0.0.1:8080";`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });

  it('does not flag https:// URLs', () => {
    const violations = check(`const url = "https://api.example.com";`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });

  it('detects http:// in Python', () => {
    const violations = check(`url = "http://api.example.com"`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });
});

// ===========================================================================
// unverified-certificate
// ===========================================================================

describe('security/deterministic/unverified-certificate', () => {
  const ruleKey = 'security/deterministic/unverified-certificate';

  it('detects rejectUnauthorized: false in JS', () => {
    const violations = check(`const opts = { rejectUnauthorized: false };`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('detects NODE_TLS_REJECT_UNAUTHORIZED = "0"', () => {
    const violations = check(`process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag rejectUnauthorized: true', () => {
    const violations = check(`const opts = { rejectUnauthorized: true };`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });

  it('detects ssl._create_unverified_context() in Python', () => {
    const violations = check(`ctx = ssl._create_unverified_context()`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('detects verify=False in Python', () => {
    const violations = check(`requests.get(url, verify=False)`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag verify=True in Python', () => {
    const violations = check(`requests.get(url, verify=True)`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// permissive-cors
// ===========================================================================

describe('security/deterministic/permissive-cors', () => {
  const ruleKey = 'security/deterministic/permissive-cors';

  it('detects cors({ origin: "*" })', () => {
    const violations = check(`app.use(cors({ origin: "*" }));`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('detects res.header("Access-Control-Allow-Origin", "*")', () => {
    const violations = check(`res.header("Access-Control-Allow-Origin", "*");`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag cors with specific origin', () => {
    const violations = check(`app.use(cors({ origin: "https://example.com" }));`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// insecure-cookie
// ===========================================================================

describe('security/deterministic/insecure-cookie', () => {
  const ruleKey = 'security/deterministic/insecure-cookie';

  it('detects cookie without secure flag in JS', () => {
    const violations = check(`res.cookie("session", token, { httpOnly: true });`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag cookie with secure: true', () => {
    const violations = check(`res.cookie("session", token, { secure: true, httpOnly: true });`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });

  it('detects set_cookie without secure in Python', () => {
    const violations = check(`response.set_cookie("session", value, httponly=True)`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag set_cookie with secure=True in Python', () => {
    const violations = check(`response.set_cookie("session", value, secure=True)`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// cookie-without-httponly
// ===========================================================================

describe('security/deterministic/cookie-without-httponly', () => {
  const ruleKey = 'security/deterministic/cookie-without-httponly';

  it('detects cookie without httpOnly flag in JS', () => {
    const violations = check(`res.cookie("session", token, { secure: true });`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag cookie with httpOnly: true', () => {
    const violations = check(`res.cookie("session", token, { secure: true, httpOnly: true });`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });

  it('detects set_cookie without httponly in Python', () => {
    const violations = check(`response.set_cookie("session", value, secure=True)`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag set_cookie with httponly=True in Python', () => {
    const violations = check(`response.set_cookie("session", value, httponly=True)`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// disabled-auto-escaping
// ===========================================================================

describe('security/deterministic/disabled-auto-escaping', () => {
  const ruleKey = 'security/deterministic/disabled-auto-escaping';

  it('detects dangerouslySetInnerHTML in JSX', () => {
    const violations = check(`const el = <div dangerouslySetInnerHTML={{ __html: content }} />;`, 'typescript');
    // tsx parsing needed for JSX
    const tree = parseCode(`const el = <div dangerouslySetInnerHTML={{ __html: content }} />;`, 'tsx' as any);
    const results = checkCodeRules(tree, '/test/file.tsx', `const el = <div dangerouslySetInnerHTML={{ __html: content }} />;`, enabledRules, 'tsx' as any);
    expect(results.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('detects innerHTML assignment', () => {
    const violations = check(`element.innerHTML = userContent;`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag textContent assignment', () => {
    const violations = check(`element.textContent = userContent;`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });

  it('detects Markup() in Python', () => {
    const violations = check(`safe = Markup(user_input)`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('detects Environment(autoescape=False) in Python', () => {
    const violations = check(`env = Environment(autoescape=False)`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag Environment(autoescape=True) in Python', () => {
    const violations = check(`env = Environment(autoescape=True)`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});
