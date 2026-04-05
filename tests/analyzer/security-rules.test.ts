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

// ===========================================================================
// csrf-disabled
// ===========================================================================

describe('security/deterministic/csrf-disabled', () => {
  const ruleKey = 'security/deterministic/csrf-disabled';

  it('detects csrf: false in JS config', () => {
    const violations = check(`const config = { csrf: false };`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag csrf: true', () => {
    const violations = check(`const config = { csrf: true };`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// weak-cipher
// ===========================================================================

describe('security/deterministic/weak-cipher', () => {
  const ruleKey = 'security/deterministic/weak-cipher';

  it('detects crypto.createCipher("des") in JS', () => {
    const violations = check(`const cipher = crypto.createCipher("des", key);`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('detects crypto.createCipheriv("rc4") in JS', () => {
    const violations = check(`const cipher = crypto.createCipheriv("rc4", key, iv);`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('detects crypto.createCipheriv("bf-cbc") in JS', () => {
    const violations = check(`const cipher = crypto.createCipheriv("bf-cbc", key, iv);`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag aes-256-gcm', () => {
    const violations = check(`const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });

  it('detects DES.new() in Python', () => {
    const violations = check(`cipher = DES.new(key, DES.MODE_ECB)`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('detects ARC4.new() in Python', () => {
    const violations = check(`cipher = ARC4.new(key)`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag AES.new() in Python', () => {
    const violations = check(`cipher = AES.new(key, AES.MODE_GCM)`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// weak-crypto-key
// ===========================================================================

describe('security/deterministic/weak-crypto-key', () => {
  const ruleKey = 'security/deterministic/weak-crypto-key';

  it('detects RSA key < 2048 bits in JS', () => {
    const violations = check(`crypto.generateKeyPair("rsa", { modulusLength: 1024 }, callback);`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag RSA key >= 2048 bits', () => {
    const violations = check(`crypto.generateKeyPair("rsa", { modulusLength: 2048 }, callback);`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });

  it('detects weak EC curve in JS', () => {
    const violations = check(`crypto.generateKeyPair("ec", { namedCurve: "secp192r1" }, callback);`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag strong EC curve', () => {
    const violations = check(`crypto.generateKeyPair("ec", { namedCurve: "secp256r1" }, callback);`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });

  it('detects RSA key_size < 2048 in Python', () => {
    const violations = check(`key = rsa.generate_private_key(public_exponent=65537, key_size=1024)`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag key_size >= 2048 in Python', () => {
    const violations = check(`key = rsa.generate_private_key(public_exponent=65537, key_size=4096)`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// weak-ssl
// ===========================================================================

describe('security/deterministic/weak-ssl', () => {
  const ruleKey = 'security/deterministic/weak-ssl';

  it('detects TLSv1_method in JS', () => {
    const violations = check(`tls.createServer({ secureProtocol: "TLSv1_method" });`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('detects SSLv3_method in JS', () => {
    const violations = check(`tls.createServer({ secureProtocol: "SSLv3_method" });`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag TLS_method without weak version', () => {
    const violations = check(`tls.createServer({ secureProtocol: "TLS_method" });`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });

  it('detects ssl.PROTOCOL_TLSv1 in Python', () => {
    const violations = check(`ctx = ssl.wrap_socket(sock, ssl_version=ssl.PROTOCOL_TLSv1)`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('detects ssl.PROTOCOL_SSLv3 in Python', () => {
    const violations = check(`ctx = ssl.wrap_socket(sock, ssl_version=ssl.PROTOCOL_SSLv3)`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });
});

// ===========================================================================
// insecure-jwt
// ===========================================================================

describe('security/deterministic/insecure-jwt', () => {
  const ruleKey = 'security/deterministic/insecure-jwt';

  it('detects jwt.sign with algorithm "none" in JS', () => {
    const violations = check(`jwt.sign(payload, key, { algorithm: "none" });`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag jwt.sign with RS256', () => {
    const violations = check(`jwt.sign(payload, key, { algorithm: "RS256" });`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });

  it('detects jwt.encode with algorithm="none" in Python', () => {
    const violations = check(`token = jwt.encode(payload, key, algorithm="none")`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag jwt.encode with RS256 in Python', () => {
    const violations = check(`token = jwt.encode(payload, key, algorithm="RS256")`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// encryption-insecure-mode
// ===========================================================================

describe('security/deterministic/encryption-insecure-mode', () => {
  const ruleKey = 'security/deterministic/encryption-insecure-mode';

  it('detects aes-128-ecb in JS', () => {
    const violations = check(`const cipher = crypto.createCipheriv("aes-128-ecb", key, null);`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag aes-256-cbc in JS', () => {
    const violations = check(`const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });

  it('detects AES.MODE_ECB in Python', () => {
    const violations = check(`cipher = AES.new(key, AES.MODE_ECB)`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag AES.MODE_GCM in Python', () => {
    const violations = check(`cipher = AES.new(key, AES.MODE_GCM, nonce=nonce)`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// missing-content-security-policy
// ===========================================================================

describe('security/deterministic/missing-content-security-policy', () => {
  const ruleKey = 'security/deterministic/missing-content-security-policy';

  it('detects helmet({ contentSecurityPolicy: false })', () => {
    const violations = check(`app.use(helmet({ contentSecurityPolicy: false }));`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag helmet() without disabling CSP', () => {
    const violations = check(`app.use(helmet());`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });

  it('does not flag helmet with CSP enabled', () => {
    const violations = check(`app.use(helmet({ contentSecurityPolicy: true }));`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// missing-frame-ancestors
// ===========================================================================

describe('security/deterministic/missing-frame-ancestors', () => {
  const ruleKey = 'security/deterministic/missing-frame-ancestors';

  it('detects helmet({ frameguard: false })', () => {
    const violations = check(`app.use(helmet({ frameguard: false }));`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag helmet() without disabling frameguard', () => {
    const violations = check(`app.use(helmet());`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// missing-strict-transport
// ===========================================================================

describe('security/deterministic/missing-strict-transport', () => {
  const ruleKey = 'security/deterministic/missing-strict-transport';

  it('detects helmet({ hsts: false })', () => {
    const violations = check(`app.use(helmet({ hsts: false }));`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag helmet() without disabling hsts', () => {
    const violations = check(`app.use(helmet());`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// missing-referrer-policy
// ===========================================================================

describe('security/deterministic/missing-referrer-policy', () => {
  const ruleKey = 'security/deterministic/missing-referrer-policy';

  it('detects helmet({ referrerPolicy: false })', () => {
    const violations = check(`app.use(helmet({ referrerPolicy: false }));`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag helmet() without disabling referrerPolicy', () => {
    const violations = check(`app.use(helmet());`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// missing-mime-sniff-protection
// ===========================================================================

describe('security/deterministic/missing-mime-sniff-protection', () => {
  const ruleKey = 'security/deterministic/missing-mime-sniff-protection';

  it('detects helmet({ noSniff: false })', () => {
    const violations = check(`app.use(helmet({ noSniff: false }));`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag helmet() without disabling noSniff', () => {
    const violations = check(`app.use(helmet());`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// server-fingerprinting
// ===========================================================================

describe('security/deterministic/server-fingerprinting', () => {
  const ruleKey = 'security/deterministic/server-fingerprinting';

  it('detects res.setHeader("X-Powered-By", ...)', () => {
    const violations = check(`res.setHeader("X-Powered-By", "Express");`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('detects res.header("X-Powered-By", ...)', () => {
    const violations = check(`res.header("X-Powered-By", "Express");`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag other headers', () => {
    const violations = check(`res.setHeader("Content-Type", "application/json");`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// unverified-hostname
// ===========================================================================

describe('security/deterministic/unverified-hostname', () => {
  const ruleKey = 'security/deterministic/unverified-hostname';

  it('detects checkServerIdentity override in JS', () => {
    const violations = check(`const opts = { checkServerIdentity: () => undefined };`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag other object properties', () => {
    const violations = check(`const opts = { rejectUnauthorized: true };`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });

  it('detects check_hostname = False in Python', () => {
    const violations = check(`ctx.check_hostname = False`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag check_hostname = True in Python', () => {
    const violations = check(`ctx.check_hostname = True`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// xml-xxe
// ===========================================================================

describe('security/deterministic/xml-xxe', () => {
  const ruleKey = 'security/deterministic/xml-xxe';

  it('detects new DOMParser() in JS', () => {
    const violations = check(`const parser = new DOMParser();`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('detects parseString() without options in JS', () => {
    const violations = check(`parseString(xmlData);`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('detects ET.parse() in Python', () => {
    const violations = check(`tree = ET.parse("data.xml")`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('detects etree.fromstring() in Python', () => {
    const violations = check(`root = etree.fromstring(xml_data)`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });
});

// ===========================================================================
// unsafe-unzip
// ===========================================================================

describe('security/deterministic/unsafe-unzip', () => {
  const ruleKey = 'security/deterministic/unsafe-unzip';

  it('detects extractAllTo() in JS', () => {
    const violations = check(`zip.extractAllTo("/tmp/output", true);`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('detects zip.extract() in JS', () => {
    const violations = check(`zip.extract("entry.txt", "/tmp");`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag unrelated method calls', () => {
    const violations = check(`data.extract("field");`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });

  it('detects zipfile.extractall() in Python', () => {
    const violations = check(`zipfile.extractall("/tmp/output")`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag unrelated extractall in Python', () => {
    const violations = check(`data.extractall()`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});
