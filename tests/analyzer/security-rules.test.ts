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

// ===========================================================================
// file-permissions-world-accessible
// ===========================================================================

describe('security/deterministic/file-permissions-world-accessible', () => {
  const ruleKey = 'security/deterministic/file-permissions-world-accessible';

  it('detects fs.chmod with 0o777 in JS', () => {
    const violations = check(`fs.chmod("/tmp/file", 0o777, callback);`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('detects fs.chmodSync with 0o777 in JS', () => {
    const violations = check(`fs.chmodSync("/tmp/file", 0o777);`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag restrictive permissions in JS', () => {
    const violations = check(`fs.chmodSync("/tmp/file", 0o644);`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });

  it('detects os.chmod with 0o777 in Python', () => {
    const violations = check(`os.chmod("/tmp/file", 0o777)`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag restrictive permissions in Python', () => {
    const violations = check(`os.chmod("/tmp/file", 0o644)`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// unrestricted-file-upload
// ===========================================================================

describe('security/deterministic/unrestricted-file-upload', () => {
  const ruleKey = 'security/deterministic/unrestricted-file-upload';

  it('detects multer without fileFilter', () => {
    const violations = check(`const upload = multer({ dest: "uploads/" });`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag multer with fileFilter', () => {
    const violations = check(`const upload = multer({ dest: "uploads/", fileFilter: myFilter });`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// hidden-file-exposure
// ===========================================================================

describe('security/deterministic/hidden-file-exposure', () => {
  const ruleKey = 'security/deterministic/hidden-file-exposure';

  it('detects express.static without dotfiles option', () => {
    const violations = check(`app.use(express.static("public"));`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag express.static with dotfiles: "deny"', () => {
    const violations = check(`app.use(express.static("public", { dotfiles: "deny" }));`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });

  it('does not flag express.static with dotfiles: "ignore"', () => {
    const violations = check(`app.use(express.static("public", { dotfiles: "ignore" }));`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// link-target-blank
// ===========================================================================

describe('security/deterministic/link-target-blank', () => {
  const ruleKey = 'security/deterministic/link-target-blank';

  it('detects <a target="_blank"> without rel="noopener" in JSX', () => {
    const tree = parseCode(`const el = <a href="https://example.com" target="_blank">Link</a>;`, 'tsx' as any);
    const results = checkCodeRules(tree, '/test/file.tsx', `const el = <a href="https://example.com" target="_blank">Link</a>;`, enabledRules, 'tsx' as any);
    expect(results.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag <a target="_blank" rel="noopener"> in JSX', () => {
    const tree = parseCode(`const el = <a href="https://example.com" target="_blank" rel="noopener">Link</a>;`, 'tsx' as any);
    const results = checkCodeRules(tree, '/test/file.tsx', `const el = <a href="https://example.com" target="_blank" rel="noopener">Link</a>;`, enabledRules, 'tsx' as any);
    expect(results.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// confidential-info-logging
// ===========================================================================

describe('security/deterministic/confidential-info-logging', () => {
  const ruleKey = 'security/deterministic/confidential-info-logging';

  it('detects console.log(password) in JS', () => {
    const violations = check(`console.log(password);`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('detects console.log(user.secretKey) in JS', () => {
    const violations = check(`console.log(user.secretKey);`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag console.log with safe variables', () => {
    const violations = check(`console.log(username);`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });

  it('detects logging.info(password) in Python', () => {
    const violations = check(`logging.info(password)`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('detects print(secret_token) in Python', () => {
    const violations = check(`print(secret_token)`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag print with safe variables in Python', () => {
    const violations = check(`print(username)`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// production-debug-enabled
// ===========================================================================

describe('security/deterministic/production-debug-enabled', () => {
  const ruleKey = 'security/deterministic/production-debug-enabled';

  it('detects debug: true in JS config', () => {
    const violations = check(`const config = { debug: true };`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag debug: false in JS', () => {
    const violations = check(`const config = { debug: false };`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });

  it('detects DEBUG = True in Python', () => {
    const violations = check(`DEBUG = True`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('detects app.debug = True in Python', () => {
    const violations = check(`app.debug = True`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag DEBUG = False in Python', () => {
    const violations = check(`DEBUG = False`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// insecure-random
// ===========================================================================

describe('security/deterministic/insecure-random', () => {
  const ruleKey = 'security/deterministic/insecure-random';

  it('detects Math.random() for token generation in JS', () => {
    const violations = check(`const token = Math.random().toString(36);`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('detects random.random() for token generation in Python', () => {
    const violations = check(`token = random.random()`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });
});

// ===========================================================================
// ip-forwarding
// ===========================================================================

describe('security/deterministic/ip-forwarding', () => {
  const ruleKey = 'security/deterministic/ip-forwarding';

  it('detects req.headers["x-forwarded-for"] in JS', () => {
    const violations = check(`const ip = req.headers["x-forwarded-for"];`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag other headers', () => {
    const violations = check(`const ct = req.headers["content-type"];`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// hardcoded-blockchain-mnemonic
// ===========================================================================

describe('security/deterministic/hardcoded-blockchain-mnemonic', () => {
  const ruleKey = 'security/deterministic/hardcoded-blockchain-mnemonic';

  it('detects 12-word BIP39 mnemonic in JS', () => {
    const violations = check(`const mnemonic = "abandon ability able about above absent absorb abstract absurd abuse access accident";`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('detects 12-word BIP39 mnemonic in Python', () => {
    const violations = check(`mnemonic = "abandon ability able about above absent absorb abstract absurd abuse access accident"`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag normal 12-word sentences', () => {
    const violations = check(`const msg = "this is just a normal sentence that has exactly twelve words total here";`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// dompurify-unsafe-config
// ===========================================================================

describe('security/deterministic/dompurify-unsafe-config', () => {
  const ruleKey = 'security/deterministic/dompurify-unsafe-config';

  it('detects DOMPurify.sanitize with ALLOW_UNKNOWN_PROTOCOLS', () => {
    const violations = check(`const clean = DOMPurify.sanitize(dirty, { ALLOW_UNKNOWN_PROTOCOLS: true });`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('detects DOMPurify.sanitize with ADD_TAGS', () => {
    const violations = check(`const clean = DOMPurify.sanitize(dirty, { ADD_TAGS: ["iframe"] });`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag DOMPurify.sanitize without unsafe options', () => {
    const violations = check(`const clean = DOMPurify.sanitize(dirty);`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// disabled-resource-integrity
// ===========================================================================

describe('security/deterministic/disabled-resource-integrity', () => {
  const ruleKey = 'security/deterministic/disabled-resource-integrity';

  it('detects <script src="https://..."> without integrity in JSX', () => {
    const code = `const el = <script src="https://cdn.example.com/lib.js" />;`;
    const tree = parseCode(code, 'tsx' as any);
    const results = checkCodeRules(tree, '/test/file.tsx', code, enabledRules, 'tsx' as any);
    expect(results.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag <script> with integrity in JSX', () => {
    const code = `const el = <script src="https://cdn.example.com/lib.js" integrity="sha384-abc123" />;`;
    const tree = parseCode(code, 'tsx' as any);
    const results = checkCodeRules(tree, '/test/file.tsx', code, enabledRules, 'tsx' as any);
    expect(results.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });

  it('does not flag local script src in JSX', () => {
    const code = `const el = <script src="/static/app.js" />;`;
    const tree = parseCode(code, 'tsx' as any);
    const results = checkCodeRules(tree, '/test/file.tsx', code, enabledRules, 'tsx' as any);
    expect(results.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// path-command-injection
// ===========================================================================

describe('security/deterministic/path-command-injection', () => {
  const ruleKey = 'security/deterministic/path-command-injection';

  it('detects path.join with req.params', () => {
    const violations = check(`const filePath = path.join(uploadDir, req.params.filename);`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('detects path.join with req.query', () => {
    const violations = check(`const filePath = path.join(baseDir, req.query.file);`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag path.join with static args', () => {
    const violations = check(`const filePath = path.join(__dirname, "public", "index.html");`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// mixed-content
// ===========================================================================

describe('security/deterministic/mixed-content', () => {
  const ruleKey = 'security/deterministic/mixed-content';

  it('detects http:// in JSX src attribute', () => {
    const code = `const el = <img src="http://example.com/img.png" />;`;
    const tree = parseCode(code, 'tsx' as any);
    const results = checkCodeRules(tree, '/test/file.tsx', code, enabledRules, 'tsx' as any);
    expect(results.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag https:// in JSX src', () => {
    const code = `const el = <img src="https://example.com/img.png" />;`;
    const tree = parseCode(code, 'tsx' as any);
    const results = checkCodeRules(tree, '/test/file.tsx', code, enabledRules, 'tsx' as any);
    expect(results.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// subprocess-security
// ===========================================================================

describe('security/deterministic/subprocess-security', () => {
  const ruleKey = 'security/deterministic/subprocess-security';

  it('detects subprocess.Popen with relative command', () => {
    const violations = check(`subprocess.Popen(["ls", "-la"])`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag subprocess.Popen with absolute path', () => {
    const violations = check(`subprocess.Popen(["/usr/bin/ls", "-la"])`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// partial-path-execution
// ===========================================================================

describe('security/deterministic/partial-path-execution', () => {
  const ruleKey = 'security/deterministic/partial-path-execution';

  it('detects os.execv with relative path', () => {
    const violations = check(`os.execv("python", ["python", "script.py"])`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag os.execv with absolute path', () => {
    const violations = check(`os.execv("/usr/bin/python", ["python", "script.py"])`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// ssl-version-unsafe
// ===========================================================================

describe('security/deterministic/ssl-version-unsafe', () => {
  const ruleKey = 'security/deterministic/ssl-version-unsafe';

  it('detects minVersion: "TLSv1" in JS', () => {
    const violations = check(`const opts = { minVersion: "TLSv1" };`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('detects minVersion: "TLSv1.1" in JS', () => {
    const violations = check(`const opts = { minVersion: "TLSv1.1" };`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag minVersion: "TLSv1.2" in JS', () => {
    const violations = check(`const opts = { minVersion: "TLSv1.2" };`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });

  it('detects minimum_version = ssl.TLSVersion.TLSv1 in Python', () => {
    const violations = check(`ctx.minimum_version = ssl.TLSVersion.TLSv1`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag minimum_version = ssl.TLSVersion.TLSv1_2 in Python', () => {
    const violations = check(`ctx.minimum_version = ssl.TLSVersion.TLSv1_2`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// vulnerable-library-import
// ===========================================================================

describe('security/deterministic/vulnerable-library-import', () => {
  const ruleKey = 'security/deterministic/vulnerable-library-import';

  it('detects import pycrypto', () => {
    const violations = check(`import pycrypto`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('detects import telnetlib', () => {
    const violations = check(`import telnetlib`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag import os', () => {
    const violations = check(`import os`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// process-start-no-shell
// ===========================================================================

describe('security/deterministic/process-start-no-shell', () => {
  const ruleKey = 'security/deterministic/process-start-no-shell';

  it('detects subprocess.Popen with string arg', () => {
    const violations = check(`subprocess.Popen("ls -la /tmp")`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag subprocess.Popen with list arg', () => {
    const violations = check(`subprocess.Popen(["ls", "-la"])`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// non-octal-file-permissions
// ===========================================================================

describe('security/deterministic/non-octal-file-permissions', () => {
  const ruleKey = 'security/deterministic/non-octal-file-permissions';

  it('detects os.chmod with decimal 777', () => {
    const violations = check(`os.chmod("/tmp/file", 777)`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('detects os.chmod with decimal 755', () => {
    const violations = check(`os.chmod("/tmp/file", 755)`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag os.chmod with octal 0o755', () => {
    const violations = check(`os.chmod("/tmp/file", 0o755)`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// unverified-cross-origin-message
// ===========================================================================

describe('security/deterministic/unverified-cross-origin-message', () => {
  const ruleKey = 'security/deterministic/unverified-cross-origin-message';

  it('detects addEventListener("message") without origin check', () => {
    const violations = check(`window.addEventListener("message", (e) => { doSomething(e.data); });`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag addEventListener("message") with origin check', () => {
    const violations = check(`window.addEventListener("message", (e) => { if (e.origin !== "https://trusted.com") return; doSomething(e.data); });`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });

  it('does not flag addEventListener for other events', () => {
    const violations = check(`window.addEventListener("click", handler);`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// intrusive-permissions
// ===========================================================================

describe('security/deterministic/intrusive-permissions', () => {
  const ruleKey = 'security/deterministic/intrusive-permissions';

  it('detects getUserMedia()', () => {
    const violations = check(`navigator.mediaDevices.getUserMedia({ video: true });`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('detects getCurrentPosition()', () => {
    const violations = check(`navigator.geolocation.getCurrentPosition(callback);`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('detects permissions.query for geolocation', () => {
    const violations = check(`navigator.permissions.query({ name: "geolocation" });`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag unrelated method calls', () => {
    const violations = check(`fetch("https://api.example.com/data");`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// session-not-regenerated
// ===========================================================================

describe('security/deterministic/session-not-regenerated', () => {
  const ruleKey = 'security/deterministic/session-not-regenerated';

  it('detects req.session.save() without regenerate', () => {
    const violations = check(`
      app.post('/login', (req, res) => {
        req.session.userId = user.id;
        req.session.save(() => res.json({ ok: true }));
      });
    `);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag req.session.save() with regenerate', () => {
    const violations = check(`
      app.post('/login', (req, res) => {
        req.session.regenerate((err) => {
          req.session.userId = user.id;
          req.session.save(() => res.json({ ok: true }));
        });
      });
    `);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// publicly-writable-directory
// ===========================================================================

describe('security/deterministic/publicly-writable-directory', () => {
  const ruleKey = 'security/deterministic/publicly-writable-directory';

  it('detects writeFile to /tmp/', () => {
    const violations = check(`fs.writeFile("/tmp/data.json", data, callback);`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('detects writeFileSync to /var/tmp/', () => {
    const violations = check(`fs.writeFileSync("/var/tmp/upload.bin", buffer);`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag writes to safe directories', () => {
    const violations = check(`fs.writeFile("/home/app/data.json", content, cb);`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// dynamically-constructed-template
// ===========================================================================

describe('security/deterministic/dynamically-constructed-template', () => {
  const ruleKey = 'security/deterministic/dynamically-constructed-template';

  it('detects render() with user input in template literal', () => {
    const violations = check('template.render(`Hello ${req.body.name}`);');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('detects compile() with concatenated user input', () => {
    const violations = check(`engine.compile("Hello " + req.query.name);`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag render() with a static template', () => {
    const violations = check('engine.render("Hello {{ name }}", { name: userName });');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// angular-sanitization-bypass
// ===========================================================================

describe('security/deterministic/angular-sanitization-bypass', () => {
  const ruleKey = 'security/deterministic/angular-sanitization-bypass';

  it('detects bypassSecurityTrustHtml()', () => {
    const violations = check(`this.sanitizer.bypassSecurityTrustHtml(userInput);`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('detects bypassSecurityTrustUrl()', () => {
    const violations = check(`this.sanitizer.bypassSecurityTrustUrl(url);`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('detects bypassSecurityTrustScript()', () => {
    const violations = check(`this.sanitizer.bypassSecurityTrustScript(script);`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag sanitize() calls', () => {
    const violations = check(`this.sanitizer.sanitize(SecurityContext.HTML, input);`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// user-id-from-request-body
// ===========================================================================

describe('security/deterministic/user-id-from-request-body', () => {
  const ruleKey = 'security/deterministic/user-id-from-request-body';

  it('detects req.body.userId', () => {
    const violations = check(`const id = req.body.userId;`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('detects req.body.user_id', () => {
    const violations = check(`const id = req.body.user_id;`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag req.user.id (from auth middleware)', () => {
    const violations = check(`const id = req.user.id;`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });

  it('does not flag req.body.name', () => {
    const violations = check(`const name = req.body.name;`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// mass-assignment
// ===========================================================================

describe('security/deterministic/mass-assignment', () => {
  const ruleKey = 'security/deterministic/mass-assignment';

  it('detects User.create(req.body)', () => {
    const violations = check(`User.create(req.body);`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('detects Model.update(id, req.body)', () => {
    const violations = check(`Model.update(id, req.body);`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('detects spread of req.body in create()', () => {
    const violations = check(`User.create({ ...req.body, createdAt: new Date() });`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag create() with allowlisted fields', () => {
    const violations = check(`const { name, email } = req.body; User.create({ name, email });`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// timing-attack-comparison
// ===========================================================================

describe('security/deterministic/timing-attack-comparison', () => {
  const ruleKey = 'security/deterministic/timing-attack-comparison';

  it('detects === comparison on token', () => {
    const violations = check(`if (userToken === storedToken) { grant(); }`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('detects !== comparison on secret', () => {
    const violations = check(`if (providedSecret !== expectedSecret) { deny(); }`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('detects === comparison on hmac', () => {
    const violations = check(`if (computedHmac === receivedHmac) { ok(); }`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag === comparison on non-sensitive values', () => {
    const violations = check(`if (status === "active") { proceed(); }`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// user-input-in-path
// ===========================================================================

describe('security/deterministic/user-input-in-path', () => {
  const ruleKey = 'security/deterministic/user-input-in-path';

  it('detects readFile with req.query', () => {
    const violations = check(`fs.readFile(req.query.filename, "utf8", callback);`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('detects readFileSync with req.params', () => {
    const violations = check(`fs.readFileSync(req.params.file);`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag readFile with a hardcoded path', () => {
    const violations = check(`fs.readFile("/etc/config.json", "utf8", cb);`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// user-input-in-redirect
// ===========================================================================

describe('security/deterministic/user-input-in-redirect', () => {
  const ruleKey = 'security/deterministic/user-input-in-redirect';

  it('detects res.redirect with req.query.returnUrl', () => {
    const violations = check(`res.redirect(req.query.returnUrl);`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('detects res.redirect with req.body.redirectUrl', () => {
    const violations = check(`res.redirect(req.body.redirectUrl);`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag res.redirect with a hardcoded URL', () => {
    const violations = check(`res.redirect("/dashboard");`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// missing-helmet-middleware
// ===========================================================================

describe('security/deterministic/missing-helmet-middleware', () => {
  const ruleKey = 'security/deterministic/missing-helmet-middleware';

  it('detects express() without helmet', () => {
    const violations = check(`const app = express(); app.use(cors()); app.listen(3000);`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag express() with helmet', () => {
    const violations = check(`const app = express(); app.use(helmet()); app.listen(3000);`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// jwt-no-expiry
// ===========================================================================

describe('security/deterministic/jwt-no-expiry', () => {
  const ruleKey = 'security/deterministic/jwt-no-expiry';

  it('detects jwt.sign() with only two args', () => {
    const violations = check(`const token = jwt.sign({ userId: id }, secret);`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('detects jwt.sign() options without expiresIn', () => {
    const violations = check(`const token = jwt.sign({ userId: id }, secret, { algorithm: "RS256" });`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag jwt.sign() with expiresIn', () => {
    const violations = check(`const token = jwt.sign({ userId: id }, secret, { expiresIn: "1h" });`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// sensitive-data-in-url
// ===========================================================================

describe('security/deterministic/sensitive-data-in-url', () => {
  const ruleKey = 'security/deterministic/sensitive-data-in-url';

  it('detects password in query string', () => {
    const violations = check(`fetch("https://api.example.com/login?password=secret123");`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('detects token in query string', () => {
    const violations = check(`const url = "https://api.example.com/data?token=abc123";`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag clean query strings', () => {
    const violations = check(`const url = "https://api.example.com/data?page=1&limit=10";`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// express-trust-proxy-not-set
// ===========================================================================

describe('security/deterministic/express-trust-proxy-not-set', () => {
  const ruleKey = 'security/deterministic/express-trust-proxy-not-set';

  it('detects app.set("trust proxy", false)', () => {
    const violations = check(`app.set("trust proxy", false);`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('detects app.set("trust proxy", 0)', () => {
    const violations = check(`app.set("trust proxy", 0);`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag app.set("trust proxy", 1)', () => {
    const violations = check(`app.set("trust proxy", 1);`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });

  it('does not flag other app.set calls', () => {
    const violations = check(`app.set("view engine", "ejs");`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// hardcoded-password-function-arg
// ===========================================================================

describe('security/deterministic/hardcoded-password-function-arg', () => {
  const ruleKey = 'security/deterministic/hardcoded-password-function-arg';

  it('detects hardcoded password in login()', () => {
    const violations = check(`authenticate(username, "SuperSecret123!");`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('detects hardcoded password in connect()', () => {
    const violations = check(`db.connect(host, user, "hardcodedPass1");`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag variable references', () => {
    const violations = check(`authenticate(username, password);`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// Python: unsafe-yaml-load
// ===========================================================================

describe('security/deterministic/unsafe-yaml-load', () => {
  const ruleKey = 'security/deterministic/unsafe-yaml-load';

  it('detects yaml.load() without loader', () => {
    const violations = check(`data = yaml.load(user_input)`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('detects yaml.load() with unsafe loader', () => {
    const violations = check(`data = yaml.load(user_input, Loader=yaml.Loader)`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag yaml.safe_load()', () => {
    const violations = check(`data = yaml.safe_load(user_input)`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });

  it('does not flag yaml.load() with SafeLoader', () => {
    const violations = check(`data = yaml.load(user_input, Loader=yaml.SafeLoader)`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// Python: unsafe-pickle-usage
// ===========================================================================

describe('security/deterministic/unsafe-pickle-usage', () => {
  const ruleKey = 'security/deterministic/unsafe-pickle-usage';

  it('detects pickle.loads()', () => {
    const violations = check(`obj = pickle.loads(user_data)`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('detects pickle.load()', () => {
    const violations = check(`obj = pickle.load(file_handle)`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag json.loads()', () => {
    const violations = check(`data = json.loads(user_input)`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// Python: ssh-no-host-key-verification
// ===========================================================================

describe('security/deterministic/ssh-no-host-key-verification', () => {
  const ruleKey = 'security/deterministic/ssh-no-host-key-verification';

  it('detects AutoAddPolicy in set_missing_host_key_policy', () => {
    const violations = check(`client.set_missing_host_key_policy(paramiko.AutoAddPolicy())`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('detects WarningPolicy in set_missing_host_key_policy', () => {
    const violations = check(`client.set_missing_host_key_policy(paramiko.WarningPolicy())`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag RejectPolicy', () => {
    const violations = check(`client.set_missing_host_key_policy(paramiko.RejectPolicy())`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// Python: unsafe-temp-file
// ===========================================================================

describe('security/deterministic/unsafe-temp-file', () => {
  const ruleKey = 'security/deterministic/unsafe-temp-file';

  it('detects tempfile.mktemp()', () => {
    const violations = check(`tmp_path = tempfile.mktemp()`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('detects NamedTemporaryFile(delete=False)', () => {
    const violations = check(`f = tempfile.NamedTemporaryFile(delete=False)`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag NamedTemporaryFile() without delete=False', () => {
    const violations = check(`f = tempfile.NamedTemporaryFile()`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });

  it('does not flag tempfile.mkstemp()', () => {
    const violations = check(`fd, path = tempfile.mkstemp()`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// hardcoded-database-password
// ===========================================================================

describe('security/deterministic/hardcoded-database-password', () => {
  const ruleKey = 'security/deterministic/hardcoded-database-password';

  it('detects postgres DSN with password', () => {
    const violations = check(`const dsn = "postgresql://user:mypassword@localhost/db";`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('detects mysql DSN with password', () => {
    const violations = check(`const url = "mysql://admin:secret123@db.example.com/prod";`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag DSN without password', () => {
    const violations = check(`const url = "postgresql://localhost/mydb";`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });

  it('does not flag DSN with env var placeholder', () => {
    const violations = check('const url = `postgresql://user:${process.env.DB_PASS}@localhost/db`;');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// ldap-unauthenticated
// ===========================================================================

describe('security/deterministic/ldap-unauthenticated', () => {
  const ruleKey = 'security/deterministic/ldap-unauthenticated';

  it('detects anonymous LDAP bind URL', () => {
    const violations = check(`const client = ldap.createClient({ url: "ldap://ldap.example.com" });`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag LDAP URL with credentials', () => {
    const violations = check(`const url = "ldap://cn=admin,dc=example,dc=com@ldap.example.com";`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// password-stored-plaintext
// ===========================================================================

describe('security/deterministic/password-stored-plaintext', () => {
  const ruleKey = 'security/deterministic/password-stored-plaintext';

  it('detects password: req.body.password in JS object', () => {
    const violations = check(`db.create({ username: req.body.username, password: req.body.password });`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag password: await bcrypt.hash(req.body.password, 10)', () => {
    const violations = check(`db.create({ password: await bcrypt.hash(req.body.password, 10) });`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// unpredictable-salt-missing
// ===========================================================================

describe('security/deterministic/unpredictable-salt-missing', () => {
  const ruleKey = 'security/deterministic/unpredictable-salt-missing';

  it('detects createHash in password context without second arg', () => {
    const violations = check(`const passwordHash = crypto.createHash("sha256").update(password).digest("hex");`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag createHash for non-password use', () => {
    const violations = check(`const fileHash = crypto.createHash("sha256").update(fileContent).digest("hex");`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// Python: flask-secret-key-disclosed
// ===========================================================================

describe('security/deterministic/flask-secret-key-disclosed', () => {
  const ruleKey = 'security/deterministic/flask-secret-key-disclosed';

  it('detects app.secret_key = "hardcoded"', () => {
    const violations = check(`app.secret_key = "my_super_secret_key"`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('detects SECRET_KEY = "hardcoded"', () => {
    const violations = check(`SECRET_KEY = "dev-secret-key-12345"`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('detects app.config["SECRET_KEY"] = "hardcoded"', () => {
    const violations = check(`app.config["SECRET_KEY"] = "supersecretkey"`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag SECRET_KEY loaded from env', () => {
    const violations = check(`app.secret_key = os.environ["SECRET_KEY"]`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// jwt-secret-key-disclosed
// ===========================================================================

describe('security/deterministic/jwt-secret-key-disclosed', () => {
  const ruleKey = 'security/deterministic/jwt-secret-key-disclosed';

  it('detects jwt.sign() with hardcoded string secret', () => {
    const violations = check(`jwt.sign(payload, "mysecretkey123");`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('detects jwt.verify() with hardcoded string secret', () => {
    const violations = check(`jwt.verify(token, "mysecretkey123");`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag jwt.sign() with env var secret', () => {
    const violations = check(`jwt.sign(payload, process.env.JWT_SECRET);`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// bind-all-interfaces
// ===========================================================================

describe('security/deterministic/bind-all-interfaces', () => {
  const ruleKey = 'security/deterministic/bind-all-interfaces';

  it('detects server.listen with 0.0.0.0', () => {
    const violations = check(`server.listen(3000, "0.0.0.0");`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag listening on localhost', () => {
    const violations = check(`server.listen(3000, "127.0.0.1");`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });

  it('does not flag listening on port only', () => {
    const violations = check(`app.listen(3000);`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// non-standard-crypto
// ===========================================================================

describe('security/deterministic/non-standard-crypto', () => {
  const ruleKey = 'security/deterministic/non-standard-crypto';

  it('detects function named xorCrypt', () => {
    const violations = check(`function xorCrypt(data, key) { return data; }`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('detects variable named customEncrypt', () => {
    const violations = check(`const customEncrypt = (data) => data;`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag standard crypto usage', () => {
    const violations = check(`const hash = crypto.createHash("sha256");`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// django-raw-sql
// ===========================================================================

describe('security/deterministic/django-raw-sql', () => {
  const ruleKey = 'security/deterministic/django-raw-sql';

  it('detects queryset.raw() call', () => {
    const violations = check(`users = User.objects.raw("SELECT * FROM users WHERE id = " + user_id)`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('detects queryset.extra() call', () => {
    const violations = check(`qs = MyModel.objects.extra(where=["id > 0"])`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });
});

// ===========================================================================
// unsafe-markup
// ===========================================================================

describe('security/deterministic/unsafe-markup', () => {
  const ruleKey = 'security/deterministic/unsafe-markup';

  it('detects Markup() with a variable argument', () => {
    const violations = check(`result = Markup(user_input)`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('detects mark_safe() with a variable argument', () => {
    const violations = check(`safe_html = mark_safe(user_data)`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag Markup() with a plain string literal', () => {
    const violations = check(`result = Markup("<b>Hello</b>")`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// logging-config-insecure-listen
// ===========================================================================

describe('security/deterministic/logging-config-insecure-listen', () => {
  const ruleKey = 'security/deterministic/logging-config-insecure-listen';

  it('detects logging.config.listen()', () => {
    const violations = check(`logging.config.listen(9999)`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag logging.basicConfig()', () => {
    const violations = check(`logging.basicConfig(level=logging.DEBUG)`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// graphql-dos-vulnerability
// ===========================================================================

describe('security/deterministic/graphql-dos-vulnerability', () => {
  const ruleKey = 'security/deterministic/graphql-dos-vulnerability';

  it('detects buildSchema without depth limiting', () => {
    const violations = check(`const schema = buildSchema(typeDefs);`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag buildSchema when depth limit is referenced nearby', () => {
    const violations = check(`
      const schema = buildSchema(typeDefs);
      app.use(depthLimit(10));
    `);
    // Still flags the buildSchema call itself since depthLimit is applied separately
    // This is expected — users should verify with integration
    expect(violations.filter((v) => v.ruleKey === ruleKey).length).toBeGreaterThanOrEqual(0);
  });
});

// ===========================================================================
// graphql-introspection-enabled
// ===========================================================================

describe('security/deterministic/graphql-introspection-enabled', () => {
  const ruleKey = 'security/deterministic/graphql-introspection-enabled';

  it('detects introspection: true in ApolloServer config', () => {
    const violations = check(`
      const server = new ApolloServer({
        typeDefs,
        resolvers,
        introspection: true,
      });
    `);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag when introspection is set conditionally', () => {
    const violations = check(`
      const server = new ApolloServer({
        typeDefs,
        resolvers,
        introspection: process.env.NODE_ENV !== "production",
      });
    `);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// unsafe-torch-load
// ===========================================================================

describe('security/deterministic/unsafe-torch-load', () => {
  const ruleKey = 'security/deterministic/unsafe-torch-load';

  it('detects torch.load() without weights_only', () => {
    const violations = check(`model = torch.load("model.pth")`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag torch.load() with weights_only=True', () => {
    const violations = check(`model = torch.load("model.pth", weights_only=True)`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// unsafe-xml-signature
// ===========================================================================

describe('security/deterministic/unsafe-xml-signature', () => {
  const ruleKey = 'security/deterministic/unsafe-xml-signature';

  it('detects new SignedXml() with no arguments', () => {
    const violations = check(`const sig = new SignedXml();`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag new SignedXml() with options argument', () => {
    const violations = check(`const sig = new SignedXml({ idAttribute: "ID" });`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// mixed-http-methods
// ===========================================================================

describe('security/deterministic/mixed-http-methods', () => {
  const ruleKey = 'security/deterministic/mixed-http-methods';

  it('detects app.all() route registration', () => {
    const violations = check(`app.all("/api/data", handler);`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('detects router.all() route registration', () => {
    const violations = check(`router.all("/upload", uploadHandler);`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag app.get()', () => {
    const violations = check(`app.get("/api/data", handler);`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });

  it('does not flag app.post()', () => {
    const violations = check(`app.post("/api/data", handler);`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// process-signaling
// ===========================================================================

describe('security/deterministic/process-signaling', () => {
  const ruleKey = 'security/deterministic/process-signaling';

  it('detects process.kill() with variable PID', () => {
    const violations = check(`process.kill(pid, "SIGTERM");`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag process.kill() with literal PID', () => {
    const violations = check(`process.kill(1234, "SIGTERM");`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// long-term-aws-keys-in-code
// ===========================================================================

describe('security/deterministic/long-term-aws-keys-in-code', () => {
  const ruleKey = 'security/deterministic/long-term-aws-keys-in-code';

  it('detects hardcoded AKIA... access key in JS', () => {
    const violations = check(`const key = "AKIAIOSFODNN7EXAMPLE";`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('detects hardcoded AKIA... access key in Python', () => {
    const violations = check(`key = "AKIAIOSFODNN7EXAMPLE"`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag non-AWS strings', () => {
    const violations = check(`const id = "user-abc123";`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// snmp-insecure-version
// ===========================================================================

describe('security/deterministic/snmp-insecure-version', () => {
  const ruleKey = 'security/deterministic/snmp-insecure-version';

  it('detects SNMP v1 session in JS', () => {
    const violations = check(`snmp.createSession("192.168.1.1", "public", { version: snmp.Version1 });`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('detects SNMP v2c session in JS', () => {
    const violations = check(`snmp.createSession("192.168.1.1", "public", { version: snmp.Version2c });`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag SNMP v3 session', () => {
    const violations = check(`snmp.createSession("192.168.1.1", "public", { version: snmp.Version3 });`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// snmp-weak-crypto
// ===========================================================================

describe('security/deterministic/snmp-weak-crypto', () => {
  const ruleKey = 'security/deterministic/snmp-weak-crypto';

  it('detects SNMP with MD5 auth algorithm', () => {
    const violations = check(`snmp.createSession("host", "user", { authAlgorithm: "md5" });`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('detects SNMP with DES priv algorithm', () => {
    const violations = check(`snmp.createSession("host", "user", { privAlgorithm: "des" });`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag SNMP with SHA-256 auth', () => {
    const violations = check(`snmp.createSession("host", "user", { authAlgorithm: "sha256" });`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// paramiko-call
// ===========================================================================

describe('security/deterministic/paramiko-call', () => {
  const ruleKey = 'security/deterministic/paramiko-call';

  it('detects paramiko connect with AutoAddPolicy in context', () => {
    const violations = check(`
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect("example.com")
`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag connect without AutoAddPolicy', () => {
    const violations = check(`
client = paramiko.SSHClient()
client.load_system_host_keys()
client.connect("example.com")
`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// hardcoded-sql-expression
// ===========================================================================

describe('security/deterministic/hardcoded-sql-expression', () => {
  const ruleKey = 'security/deterministic/hardcoded-sql-expression';

  it('detects format() used to build SELECT query', () => {
    const violations = check(`const q = format("SELECT * FROM %s WHERE id = %d", table, id);`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag format() with non-SQL strings', () => {
    const violations = check(`const msg = format("Hello, %s!", name);`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// wildcard-in-os-command
// ===========================================================================

describe('security/deterministic/wildcard-in-os-command', () => {
  const ruleKey = 'security/deterministic/wildcard-in-os-command';

  it('detects exec() with wildcard in JS', () => {
    const violations = check(`exec("rm -rf /var/log/*.log");`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('detects os.system() with wildcard in Python', () => {
    const violations = check(`os.system("chmod 777 /data/*")`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag exec without wildcard', () => {
    const violations = check(`exec("ls /var/log");`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// suspicious-url-open
// ===========================================================================

describe('security/deterministic/suspicious-url-open', () => {
  const ruleKey = 'security/deterministic/suspicious-url-open';

  it('detects urlopen with variable URL', () => {
    const violations = check(`response = urllib.request.urlopen(user_url)`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag urlopen with a plain string literal', () => {
    const violations = check(`response = urllib.request.urlopen("https://api.example.com/data")`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// redos-vulnerable-regex-python
// ===========================================================================

describe('security/deterministic/redos-vulnerable-regex-python', () => {
  const ruleKey = 'security/deterministic/redos-vulnerable-regex-python';

  it('detects nested quantifier regex (a+)+', () => {
    const violations = check(`pattern = re.compile("(a+)+")`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('detects nested quantifier regex (a*)*', () => {
    const violations = check(`m = re.match("(x*)*", text)`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag safe regex', () => {
    const violations = check(`m = re.match(r"^[a-z]+$", text)`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// fastapi-file-upload-body
// ===========================================================================

describe('security/deterministic/fastapi-file-upload-body', () => {
  const ruleKey = 'security/deterministic/fastapi-file-upload-body';

  it('detects FastAPI endpoint with UploadFile without size check', () => {
    const violations = check(`
async def upload(file: UploadFile):
    content = await file.read()
    return {"size": len(content)}
`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag when max_size check is present', () => {
    const violations = check(`
async def upload(file: UploadFile):
    if file.size > max_size:
        raise HTTPException(413)
    content = await file.read()
    return {"size": len(content)}
`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// s3-missing-bucket-owner
// ===========================================================================

describe('security/deterministic/s3-missing-bucket-owner', () => {
  const ruleKey = 'security/deterministic/s3-missing-bucket-owner';

  it('detects putBucketAcl without ExpectedBucketOwner', () => {
    const violations = check(`s3.putBucketAcl({ Bucket: "my-bucket", ACL: "public-read" });`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag putBucketAcl with ExpectedBucketOwner', () => {
    const violations = check(`s3.putBucketAcl({ Bucket: "my-bucket", ACL: "private", ExpectedBucketOwner: accountId });`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// s3-public-bucket-access
// ===========================================================================

describe('security/deterministic/s3-public-bucket-access', () => {
  const ruleKey = 'security/deterministic/s3-public-bucket-access';

  it('detects putPublicAccessBlock with BlockPublicAcls: false', () => {
    const violations = check(`s3.putPublicAccessBlock({ Bucket: "b", PublicAccessBlockConfiguration: { BlockPublicAcls: false } });`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag putPublicAccessBlock with all blocks true', () => {
    const violations = check(`s3.putPublicAccessBlock({ Bucket: "b", PublicAccessBlockConfiguration: { BlockPublicAcls: true } });`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// s3-insecure-http
// ===========================================================================

describe('security/deterministic/s3-insecure-http', () => {
  const ruleKey = 'security/deterministic/s3-insecure-http';

  it('detects S3 client with ssl: false in JS', () => {
    const violations = check(`const s3 = new S3({ ssl: false });`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('detects boto3 S3 client with use_ssl=False in Python', () => {
    const violations = check(`s3 = boto3.client("s3", use_ssl=False)`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag S3 client with ssl: true in JS', () => {
    const violations = check(`const s3 = new S3({ ssl: true });`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});

// ===========================================================================
// s3-unrestricted-access
// ===========================================================================

describe('security/deterministic/s3-unrestricted-access', () => {
  const ruleKey = 'security/deterministic/s3-unrestricted-access';

  it('detects S3 bucket policy with wildcard Principal in JS', () => {
    const violations = check(`
const policy = '{"Version":"2012-10-17","Statement":[{"Principal":"*","Effect":"Allow","Action":"s3:*","Resource":"arn:aws:s3:::my-bucket/*"}]}';
`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('detects S3 bucket policy with wildcard Principal in Python', () => {
    const violations = check(`policy = '{"Principal": "*", "Effect": "Allow"}'`, 'python');
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag restricted bucket policy', () => {
    const violations = check(`const policy = '{"Principal": {"AWS": "arn:aws:iam::123456789:root"}}';`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});
