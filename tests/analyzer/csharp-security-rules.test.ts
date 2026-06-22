import { describe, it, expect } from 'vitest'
import { checkCodeRules } from '../../packages/analyzer/src/rules/combined-code-checker'
import { ALL_DEFAULT_RULES } from '../../packages/analyzer/src/rules/index'
import { parseCode } from '../../packages/analyzer/src/parser'

const enabledRules = ALL_DEFAULT_RULES.filter((r) => r.enabled)

function check(code: string, filePath = '/test/App.cs') {
  const tree = parseCode(code, 'csharp')
  return checkCodeRules(tree, filePath, code, enabledRules, 'csharp')
}

function matches(code: string, ruleKey: string, filePath?: string) {
  return check(code, filePath).filter((v) => v.ruleKey === `security/deterministic/${ruleKey}`)
}

// ---------------------------------------------------------------------------
// security/deterministic/sql-injection
// ---------------------------------------------------------------------------

describe('security/deterministic/sql-injection (C#)', () => {
  it('detects interpolated SQL from a method parameter passed to Dapper', () => {
    const found = matches(`using Dapper;
using Microsoft.Data.SqlClient;

namespace App.Repositories;

public class UserRepository
{
    private readonly SqlConnection _connection;

    public User? FindByEmail(string email)
    {
        return _connection.QueryFirstOrDefault<User>($"SELECT * FROM Users WHERE Email = '{email}'");
    }
}
`, 'sql-injection')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('detects concatenated SQL assigned to CommandText', () => {
    const found = matches(`using Microsoft.Data.SqlClient;

namespace App.Reports;

public class LogReader
{
    public void Load(SqlConnection connection, string day)
    {
        var cmd = connection.CreateCommand();
        cmd.CommandText = "SELECT * FROM Logs WHERE Day = '" + day + "'";
        cmd.ExecuteReader();
    }
}
`, 'sql-injection')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag parameterized Dapper queries or constant-only concatenation', () => {
    const found = matches(`using Dapper;
using Microsoft.Data.SqlClient;

namespace App.Repositories;

public class UserRepository
{
    private const string BaseQuery = "SELECT Id, Email, Name FROM Users";
    private readonly SqlConnection _connection;

    public User? FindByEmail(string email)
    {
        return _connection.QueryFirstOrDefault<User>(
            "SELECT * FROM Users WHERE Email = @Email", new { Email = email });
    }

    public void Load(string region)
    {
        var cmd = _connection.CreateCommand();
        cmd.CommandText = BaseQuery + " ORDER BY CreatedAt DESC";
        cmd.ExecuteReader();
    }
}
`, 'sql-injection')
    expect(found).toHaveLength(0)
  })

  it('does not flag EF Core FromSqlInterpolated (parameterized by design)', () => {
    const found = matches(`using Microsoft.EntityFrameworkCore;

namespace App.Repositories;

public class OrderRepository
{
    private readonly AppDbContext _db;

    public IQueryable<Order> ForCustomer(int customerId)
    {
        return _db.Orders.FromSqlInterpolated($"SELECT * FROM Orders WHERE CustomerId = {customerId}");
    }
}
`, 'sql-injection')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// security/deterministic/hardcoded-sql-expression
// ---------------------------------------------------------------------------

describe('security/deterministic/hardcoded-sql-expression (C#)', () => {
  it('detects string.Format building SQL from runtime values', () => {
    const found = matches(`namespace App.Reports;

public class OrderQueryBuilder
{
    public string ForCustomer(int customerId)
    {
        return string.Format("SELECT * FROM Orders WHERE CustomerId = {0}", customerId);
    }
}
`, 'hardcoded-sql-expression')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag string.Format on non-SQL text', () => {
    const found = matches(`namespace App.Notifications;

public class Greeter
{
    public string Welcome(string name)
    {
        return string.Format("Welcome back, {0}! You have new messages.", name);
    }
}
`, 'hardcoded-sql-expression')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// security/deterministic/eval-usage
// ---------------------------------------------------------------------------

describe('security/deterministic/eval-usage (C#)', () => {
  it('detects CSharpScript.EvaluateAsync on a dynamically built string', () => {
    const found = matches(`using Microsoft.CodeAnalysis.CSharp.Scripting;

namespace App.Rules;

public class RuleEngine
{
    public async Task<object> Evaluate(string userExpression)
    {
        return await CSharpScript.EvaluateAsync(userExpression);
    }
}
`, 'eval-usage')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag CSharpScript with a constant script', () => {
    const found = matches(`using Microsoft.CodeAnalysis.CSharp.Scripting;

namespace App.Rules;

public class HealthCheck
{
    public async Task<object> Probe()
    {
        return await CSharpScript.EvaluateAsync("1 + 1");
    }
}
`, 'eval-usage')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// security/deterministic/os-command-injection
// ---------------------------------------------------------------------------

describe('security/deterministic/os-command-injection (C#)', () => {
  it('detects Process.Start running a shell with a concatenated command', () => {
    const found = matches(`using System.Diagnostics;

namespace App.Media;

public class ThumbnailService
{
    public void Generate(string fileName)
    {
        Process.Start("/bin/sh", "-c \\"convert " + fileName + " thumb.png\\"");
    }
}
`, 'os-command-injection')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('detects ProcessStartInfo with interpolated shell arguments', () => {
    const found = matches(`using System.Diagnostics;

namespace App.Ops;

public class LogDumper
{
    public void Dump(string path)
    {
        var psi = new ProcessStartInfo
        {
            FileName = "cmd.exe",
            Arguments = $"/C type {path}",
        };
        Process.Start(psi);
    }
}
`, 'os-command-injection')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag fixed arguments or the ArgumentList idiom', () => {
    const found = matches(`using System.Diagnostics;

namespace App.Git;

public class GitClient
{
    public void Status()
    {
        Process.Start("git", "status --porcelain");
    }

    public void Clone(string repoUrl)
    {
        var psi = new ProcessStartInfo { FileName = "git" };
        psi.ArgumentList.Add("clone");
        psi.ArgumentList.Add(repoUrl);
        Process.Start(psi);
    }
}
`, 'os-command-injection')
    expect(found).toHaveLength(0)
  })

  it('does not flag -c config flags for non-shell tools', () => {
    const found = matches(`using System.Diagnostics;

namespace App.Ops;

public class NginxReloader
{
    public void Validate(string configPath)
    {
        var psi = new ProcessStartInfo
        {
            FileName = "nginx",
            Arguments = $"-c {configPath} -t",
        };
        Process.Start(psi);
    }
}
`, 'os-command-injection')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// security/deterministic/wildcard-in-os-command
// ---------------------------------------------------------------------------

describe('security/deterministic/wildcard-in-os-command (C#)', () => {
  it('detects a glob wildcard in a shell command', () => {
    const found = matches(`using System.Diagnostics;

namespace App.Ops;

public class CacheJanitor
{
    public void Purge()
    {
        Process.Start("/bin/bash", "-c \\"rm -rf /var/cache/app/*\\"");
    }
}
`, 'wildcard-in-os-command')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag shell commands without wildcards', () => {
    const found = matches(`using System.Diagnostics;

namespace App.Ops;

public class ServiceManager
{
    public void Restart()
    {
        Process.Start("/bin/bash", "-c \\"systemctl restart app\\"");
    }
}
`, 'wildcard-in-os-command')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// security/deterministic/weak-hashing
// ---------------------------------------------------------------------------

describe('security/deterministic/weak-hashing (C#)', () => {
  it('detects MD5.Create() and SHA1.HashData()', () => {
    const found = matches(`using System.Security.Cryptography;
using System.Text;

namespace App.Auth;

public class LegacyHasher
{
    public byte[] HashPassword(string password)
    {
        using var md5 = MD5.Create();
        return md5.ComputeHash(Encoding.UTF8.GetBytes(password));
    }

    public byte[] Fingerprint(byte[] payload)
    {
        return SHA1.HashData(payload);
    }
}
`, 'weak-hashing')
    expect(found.length).toBeGreaterThanOrEqual(2)
  })

  it('does not flag SHA-256', () => {
    const found = matches(`using System.Security.Cryptography;
using System.Text;

namespace App.Auth;

public class Hasher
{
    public byte[] Hash(string value)
    {
        return SHA256.HashData(Encoding.UTF8.GetBytes(value));
    }
}
`, 'weak-hashing')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// security/deterministic/weak-cipher
// ---------------------------------------------------------------------------

describe('security/deterministic/weak-cipher (C#)', () => {
  it('detects TripleDES.Create() and DESCryptoServiceProvider', () => {
    const found = matches(`using System.Security.Cryptography;

namespace App.Legacy;

public class LegacyCrypto
{
    public SymmetricAlgorithm OldCipher()
    {
        return TripleDES.Create();
    }

    public SymmetricAlgorithm OlderCipher()
    {
        return new DESCryptoServiceProvider();
    }
}
`, 'weak-cipher')
    expect(found.length).toBeGreaterThanOrEqual(2)
  })

  it('does not flag AES', () => {
    const found = matches(`using System.Security.Cryptography;

namespace App.Crypto;

public class Encryptor
{
    public SymmetricAlgorithm NewCipher()
    {
        return Aes.Create();
    }
}
`, 'weak-cipher')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// security/deterministic/weak-crypto-key
// ---------------------------------------------------------------------------

describe('security/deterministic/weak-crypto-key (C#)', () => {
  it('detects a 1024-bit RSA key', () => {
    const found = matches(`using System.Security.Cryptography;

namespace App.Signing;

public class KeyFactory
{
    public RSA CreateSigningKey()
    {
        return new RSACryptoServiceProvider(1024);
    }
}
`, 'weak-crypto-key')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag 2048-bit or larger keys', () => {
    const found = matches(`using System.Security.Cryptography;

namespace App.Signing;

public class KeyFactory
{
    public RSA CreateSigningKey()
    {
        return RSA.Create(2048);
    }

    public RSA CreateStrongKey()
    {
        return new RSACryptoServiceProvider(4096);
    }
}
`, 'weak-crypto-key')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// security/deterministic/encryption-insecure-mode
// ---------------------------------------------------------------------------

describe('security/deterministic/encryption-insecure-mode (C#)', () => {
  it('detects CipherMode.ECB', () => {
    const found = matches(`using System.Security.Cryptography;

namespace App.Crypto;

public class BlockEncryptor
{
    public ICryptoTransform CreateEncryptor(byte[] key)
    {
        var aes = Aes.Create();
        aes.Key = key;
        aes.Mode = CipherMode.ECB;
        return aes.CreateEncryptor();
    }
}
`, 'encryption-insecure-mode')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag CBC mode or an ECB rejection check', () => {
    const found = matches(`using System.Security.Cryptography;

namespace App.Crypto;

public class BlockEncryptor
{
    public ICryptoTransform CreateEncryptor(Aes aes)
    {
        if (aes.Mode == CipherMode.ECB)
        {
            throw new InvalidOperationException("ECB is not allowed");
        }
        aes.Mode = CipherMode.CBC;
        return aes.CreateEncryptor();
    }
}
`, 'encryption-insecure-mode')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// security/deterministic/weak-ssl
// ---------------------------------------------------------------------------

describe('security/deterministic/weak-ssl (C#)', () => {
  it('detects TLS 1.0/1.1 protocol selections', () => {
    const found = matches(`using System.Net;
using System.Security.Authentication;

namespace App.Net;

public class LegacyTlsSetup
{
    public void Configure(HttpClientHandler handler)
    {
        ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls11;
        handler.SslProtocols = SslProtocols.Tls;
    }
}
`, 'weak-ssl')
    expect(found.length).toBeGreaterThanOrEqual(2)
  })

  it('does not flag TLS 1.2/1.3 or SslProtocols.None (OS default)', () => {
    const found = matches(`using System.Security.Authentication;

namespace App.Net;

public class TlsSetup
{
    public void Configure(HttpClientHandler handler, HttpClientHandler modern)
    {
        handler.SslProtocols = SslProtocols.Tls12 | SslProtocols.Tls13;
        modern.SslProtocols = SslProtocols.None;
    }
}
`, 'weak-ssl')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// security/deterministic/unverified-certificate
// ---------------------------------------------------------------------------

describe('security/deterministic/unverified-certificate (C#)', () => {
  it('detects an always-true certificate validation callback', () => {
    const found = matches(`using System.Net.Http;

namespace App.Net;

public class InsecureClientFactory
{
    public HttpClient Create()
    {
        var handler = new HttpClientHandler();
        handler.ServerCertificateCustomValidationCallback = (message, cert, chain, errors) => true;
        return new HttpClient(handler);
    }
}
`, 'unverified-certificate')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('detects DangerousAcceptAnyServerCertificateValidator', () => {
    const found = matches(`using System.Net.Http;

namespace App.Net;

public class InsecureClientFactory
{
    public HttpClient Create()
    {
        var handler = new HttpClientHandler
        {
            ServerCertificateCustomValidationCallback = HttpClientHandler.DangerousAcceptAnyServerCertificateValidator,
        };
        return new HttpClient(handler);
    }
}
`, 'unverified-certificate')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag a callback that actually validates', () => {
    const found = matches(`using System.Net.Http;
using System.Net.Security;

namespace App.Net;

public class ClientFactory
{
    public HttpClient Create()
    {
        var handler = new HttpClientHandler();
        handler.ServerCertificateCustomValidationCallback = (message, cert, chain, errors) => errors == SslPolicyErrors.None;
        return new HttpClient(handler);
    }
}
`, 'unverified-certificate')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// security/deterministic/permissive-cors
// ---------------------------------------------------------------------------

describe('security/deterministic/permissive-cors (C#)', () => {
  it('detects AllowAnyOrigin combined with AllowCredentials', () => {
    const found = matches(`using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.DependencyInjection;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddCors(options =>
{
    options.AddPolicy("open", policy => policy.AllowAnyOrigin().AllowAnyHeader().AllowCredentials());
});
var app = builder.Build();
app.Run();
`, 'permissive-cors')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('detects WithOrigins("*")', () => {
    const found = matches(`using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.DependencyInjection;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddCors(options =>
{
    options.AddPolicy("wild", policy => policy.WithOrigins("*").AllowAnyHeader());
});
var app = builder.Build();
app.Run();
`, 'permissive-cors')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag AllowAnyOrigin without credentials or explicit origins with credentials', () => {
    const found = matches(`using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.DependencyInjection;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddCors(options =>
{
    options.AddPolicy("public-api", policy => policy.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod());
    options.AddPolicy("app", policy => policy.WithOrigins("https://app.example.com").AllowCredentials());
});
var app = builder.Build();
app.Run();
`, 'permissive-cors')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// security/deterministic/insecure-cookie + cookie-without-httponly
// ---------------------------------------------------------------------------

describe('security/deterministic/insecure-cookie (C#)', () => {
  it('detects CookieOptions with Secure = false', () => {
    const found = matches(`using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace App.Controllers;

public class SessionController : ControllerBase
{
    public IActionResult Start(string token)
    {
        Response.Cookies.Append("session", token, new CookieOptions { Secure = false, HttpOnly = true });
        return Ok();
    }
}
`, 'insecure-cookie')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag secure cookies or unrelated Secure properties', () => {
    const found = matches(`using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace App.Controllers;

public class SessionController : ControllerBase
{
    public IActionResult Start(string token)
    {
        Response.Cookies.Append("session", token, new CookieOptions { Secure = true, HttpOnly = true });
        var ftp = new FtpSettings { Secure = false };
        return Ok(ftp);
    }
}

public class FtpSettings
{
    public bool Secure { get; set; }
}
`, 'insecure-cookie')
    expect(found).toHaveLength(0)
  })
})

describe('security/deterministic/cookie-without-httponly (C#)', () => {
  it('detects CookieOptions with HttpOnly = false', () => {
    const found = matches(`using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace App.Controllers;

public class SessionController : ControllerBase
{
    public IActionResult Start(string token)
    {
        Response.Cookies.Append("session", token, new CookieOptions { Secure = true, HttpOnly = false });
        return Ok();
    }
}
`, 'cookie-without-httponly')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag HttpOnly = true', () => {
    const found = matches(`using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace App.Controllers;

public class SessionController : ControllerBase
{
    public IActionResult Start(string token)
    {
        Response.Cookies.Append("session", token, new CookieOptions { Secure = true, HttpOnly = true });
        return Ok();
    }
}
`, 'cookie-without-httponly')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// security/deterministic/csrf-disabled
// ---------------------------------------------------------------------------

describe('security/deterministic/csrf-disabled (C#)', () => {
  it('detects [IgnoreAntiforgeryToken]', () => {
    const found = matches(`using Microsoft.AspNetCore.Mvc;

namespace App.Controllers;

public class PaymentsController : Controller
{
    [HttpPost]
    [IgnoreAntiforgeryToken]
    public IActionResult Charge(PaymentModel model)
    {
        return Ok();
    }
}
`, 'csrf-disabled')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag [ValidateAntiForgeryToken]', () => {
    const found = matches(`using Microsoft.AspNetCore.Mvc;

namespace App.Controllers;

public class PaymentsController : Controller
{
    [HttpPost]
    [ValidateAntiForgeryToken]
    public IActionResult Charge(PaymentModel model)
    {
        return Ok();
    }
}
`, 'csrf-disabled')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// security/deterministic/xml-xxe
// ---------------------------------------------------------------------------

describe('security/deterministic/xml-xxe (C#)', () => {
  it('detects DtdProcessing.Parse and an XmlUrlResolver', () => {
    const found = matches(`using System.Xml;

namespace App.Import;

public class FeedParser
{
    public XmlDocument Parse(string xml)
    {
        var settings = new XmlReaderSettings();
        settings.DtdProcessing = DtdProcessing.Parse;
        var doc = new XmlDocument();
        doc.XmlResolver = new XmlUrlResolver();
        doc.LoadXml(xml);
        return doc;
    }
}
`, 'xml-xxe')
    expect(found.length).toBeGreaterThanOrEqual(2)
  })

  it('does not flag the secure parser configuration', () => {
    const found = matches(`using System.Xml;

namespace App.Import;

public class FeedParser
{
    public XmlDocument Parse(string xml)
    {
        var settings = new XmlReaderSettings();
        settings.DtdProcessing = DtdProcessing.Prohibit;
        var doc = new XmlDocument();
        doc.XmlResolver = null;
        doc.LoadXml(xml);
        return doc;
    }
}
`, 'xml-xxe')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// security/deterministic/unsafe-pickle-usage (insecure deserialization)
// ---------------------------------------------------------------------------

describe('security/deterministic/unsafe-pickle-usage (C#)', () => {
  it('detects BinaryFormatter', () => {
    const found = matches(`using System.Runtime.Serialization.Formatters.Binary;

namespace App.Cache;

public class CacheCodec
{
    public object Decode(Stream payload)
    {
        var formatter = new BinaryFormatter();
        return formatter.Deserialize(payload);
    }
}
`, 'unsafe-pickle-usage')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('detects Newtonsoft TypeNameHandling.All', () => {
    const found = matches(`using Newtonsoft.Json;

namespace App.Messaging;

public class MessageCodec
{
    public T? Decode<T>(string json)
    {
        var settings = new JsonSerializerSettings { TypeNameHandling = TypeNameHandling.All };
        return JsonConvert.DeserializeObject<T>(json, settings);
    }
}
`, 'unsafe-pickle-usage')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag System.Text.Json or TypeNameHandling.None', () => {
    const found = matches(`using System.Text.Json;
using Newtonsoft.Json;

namespace App.Messaging;

public class MessageCodec
{
    public Order? Decode(string json)
    {
        return System.Text.Json.JsonSerializer.Deserialize<Order>(json);
    }

    public T? DecodeLegacy<T>(string json)
    {
        var settings = new JsonSerializerSettings { TypeNameHandling = TypeNameHandling.None };
        return JsonConvert.DeserializeObject<T>(json, settings);
    }
}
`, 'unsafe-pickle-usage')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// security/deterministic/insecure-jwt
// ---------------------------------------------------------------------------

describe('security/deterministic/insecure-jwt (C#)', () => {
  it('detects RequireSignedTokens = false', () => {
    const found = matches(`using Microsoft.IdentityModel.Tokens;

namespace App.Auth;

public class TokenSetup
{
    public TokenValidationParameters Build()
    {
        return new TokenValidationParameters
        {
            RequireSignedTokens = false,
            ValidateIssuer = true,
        };
    }
}
`, 'insecure-jwt')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag standard token validation parameters', () => {
    const found = matches(`using Microsoft.IdentityModel.Tokens;

namespace App.Auth;

public class TokenSetup
{
    public TokenValidationParameters Build(SecurityKey key)
    {
        return new TokenValidationParameters
        {
            RequireSignedTokens = true,
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = key,
        };
    }
}
`, 'insecure-jwt')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// security/deterministic/jwt-no-expiry
// ---------------------------------------------------------------------------

describe('security/deterministic/jwt-no-expiry (C#)', () => {
  it('detects a SecurityTokenDescriptor without Expires', () => {
    const found = matches(`using Microsoft.IdentityModel.Tokens;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;

namespace App.Auth;

public class TokenIssuer
{
    public string Issue(ClaimsIdentity identity, SigningCredentials credentials)
    {
        var descriptor = new SecurityTokenDescriptor
        {
            Subject = identity,
            SigningCredentials = credentials,
        };
        var handler = new JwtSecurityTokenHandler();
        return handler.WriteToken(handler.CreateToken(descriptor));
    }
}
`, 'jwt-no-expiry')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag a descriptor with Expires set', () => {
    const found = matches(`using Microsoft.IdentityModel.Tokens;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;

namespace App.Auth;

public class TokenIssuer
{
    public string Issue(ClaimsIdentity identity, SigningCredentials credentials)
    {
        var descriptor = new SecurityTokenDescriptor
        {
            Subject = identity,
            Expires = DateTime.UtcNow.AddMinutes(30),
            SigningCredentials = credentials,
        };
        var handler = new JwtSecurityTokenHandler();
        return handler.WriteToken(handler.CreateToken(descriptor));
    }
}
`, 'jwt-no-expiry')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// security/deterministic/jwt-secret-key-disclosed
// ---------------------------------------------------------------------------

describe('security/deterministic/jwt-secret-key-disclosed (C#)', () => {
  it('detects a SymmetricSecurityKey built from a string literal', () => {
    const found = matches(`using Microsoft.IdentityModel.Tokens;
using System.Text;

namespace App.Auth;

public class TokenSetup
{
    public SymmetricSecurityKey SigningKey()
    {
        return new SymmetricSecurityKey(Encoding.UTF8.GetBytes("dev-signing-key-do-not-use"));
    }
}
`, 'jwt-secret-key-disclosed')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag a key loaded from configuration', () => {
    const found = matches(`using Microsoft.Extensions.Configuration;
using Microsoft.IdentityModel.Tokens;
using System.Text;

namespace App.Auth;

public class TokenSetup
{
    private readonly IConfiguration _configuration;

    public SymmetricSecurityKey SigningKey()
    {
        return new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_configuration["Jwt:SigningKey"]));
    }
}
`, 'jwt-secret-key-disclosed')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// security/deterministic/timing-attack-comparison
// ---------------------------------------------------------------------------

describe('security/deterministic/timing-attack-comparison (C#)', () => {
  it('detects == comparison of two secret-like runtime values', () => {
    const found = matches(`namespace App.Webhooks;

public class WebhookValidator
{
    public bool IsValid(string providedSignature, string computedSignature)
    {
        return providedSignature == computedSignature;
    }
}
`, 'timing-attack-comparison')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag null checks, descriptor fields, or literal comparisons', () => {
    const found = matches(`namespace App.Auth;

public class HeaderParser
{
    public bool Parse(string? token, string tokenType)
    {
        if (token == null)
        {
            return false;
        }
        if (tokenType == "Bearer")
        {
            return token.Length > 16;
        }
        return false;
    }
}
`, 'timing-attack-comparison')
    expect(found).toHaveLength(0)
  })

  it('does not flag CancellationToken or enum-constant comparisons', () => {
    const found = matches(`using System.Threading;

namespace App.Jobs;

public class JobRunner
{
    public async Task Run(CancellationToken cancellationToken)
    {
        if (cancellationToken == CancellationToken.None)
        {
            throw new ArgumentException("A real cancellation token is required");
        }
        await Task.Delay(1000, cancellationToken);
    }
}
`, 'timing-attack-comparison')
    expect(found).toHaveLength(0)
  })

  it('does not flag when the file uses FixedTimeEquals', () => {
    const found = matches(`using System.Security.Cryptography;
using System.Text;

namespace App.Webhooks;

public class WebhookValidator
{
    public bool IsValid(string providedSignature, string computedSignature)
    {
        if (providedSignature.Length != computedSignature.Length)
        {
            return false;
        }
        return CryptographicOperations.FixedTimeEquals(
            Encoding.UTF8.GetBytes(providedSignature),
            Encoding.UTF8.GetBytes(computedSignature));
    }
}
`, 'timing-attack-comparison')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// security/deterministic/insecure-random
// ---------------------------------------------------------------------------

describe('security/deterministic/insecure-random (C#)', () => {
  it('detects new Random() generating a reset token', () => {
    const found = matches(`namespace App.Auth;

public class PasswordResetService
{
    public string GenerateResetToken()
    {
        var resetToken = new Random().Next(100000, 999999).ToString();
        return resetToken;
    }
}
`, 'insecure-random', '/app/Services/PasswordResetService.cs')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag Random for retry jitter', () => {
    const found = matches(`namespace App.Resilience;

public class RetryPolicy
{
    private readonly Random _random = new Random();

    public TimeSpan NextDelay(int attempt)
    {
        var jitterMs = new Random().Next(50, 250);
        return TimeSpan.FromMilliseconds(attempt * 200 + jitterMs);
    }
}
`, 'insecure-random', '/app/Resilience/RetryPolicy.cs')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// security/deterministic/production-debug-enabled
// ---------------------------------------------------------------------------

describe('security/deterministic/production-debug-enabled (C#)', () => {
  it('detects UseDeveloperExceptionPage without an environment guard', () => {
    const found = matches(`using Microsoft.AspNetCore.Builder;

namespace App;

public class Startup
{
    public void Configure(IApplicationBuilder app)
    {
        app.UseDeveloperExceptionPage();
        app.UseRouting();
    }
}
`, 'production-debug-enabled')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag the IsDevelopment-guarded idiom', () => {
    const found = matches(`using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.Hosting;

namespace App;

public class Startup
{
    public void Configure(IApplicationBuilder app, IWebHostEnvironment env)
    {
        if (env.IsDevelopment())
        {
            app.UseDeveloperExceptionPage();
        }
        else
        {
            app.UseExceptionHandler("/error");
        }
        app.UseRouting();
    }
}
`, 'production-debug-enabled')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// security/deterministic/confidential-info-logging
// ---------------------------------------------------------------------------

describe('security/deterministic/confidential-info-logging (C#)', () => {
  it('detects logging a password value', () => {
    const found = matches(`using Microsoft.Extensions.Logging;

namespace App.Auth;

public class LoginService
{
    private readonly ILogger<LoginService> _logger;

    public void Attempt(string userName, string password)
    {
        _logger.LogInformation($"Login attempt for {userName} with password {password}");
    }
}
`, 'confidential-info-logging')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag logging non-sensitive identifiers', () => {
    const found = matches(`using Microsoft.Extensions.Logging;

namespace App.Auth;

public class LoginService
{
    private readonly ILogger<LoginService> _logger;

    public void Succeeded(string userName, int attempts)
    {
        _logger.LogInformation("User {UserName} logged in after {Attempts} attempts", userName, attempts);
    }

    public void Revoked(Guid tokenId, string tokenType)
    {
        _logger.LogInformation("Revoked {TokenType} token {TokenId}", tokenType, tokenId);
    }
}
`, 'confidential-info-logging')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// security/deterministic/sensitive-data-in-url
// ---------------------------------------------------------------------------

describe('security/deterministic/sensitive-data-in-url (C#)', () => {
  it('detects a password in a URL query string', () => {
    const found = matches(`namespace App.Integrations;

public class LegacyApiClient
{
    public string LoginUrl(string user, string pass)
    {
        return $"https://legacy.example.com/login?username={user}&password={pass}";
    }
}
`, 'sensitive-data-in-url')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag ordinary query parameters', () => {
    const found = matches(`namespace App.Integrations;

public class CatalogClient
{
    public string SearchUrl(string term, int page)
    {
        return $"https://api.example.com/products?search={term}&page={page}";
    }
}
`, 'sensitive-data-in-url')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// security/deterministic/user-input-in-redirect
// ---------------------------------------------------------------------------

describe('security/deterministic/user-input-in-redirect (C#)', () => {
  it('detects Redirect() to an unvalidated returnUrl parameter', () => {
    const found = matches(`using Microsoft.AspNetCore.Mvc;

namespace App.Controllers;

public class AccountController : Controller
{
    [HttpPost]
    public IActionResult Login(LoginModel model, string returnUrl)
    {
        return Redirect(returnUrl);
    }
}
`, 'user-input-in-redirect')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag IsLocalUrl-guarded redirects, LocalRedirect, or fixed paths', () => {
    const found = matches(`using Microsoft.AspNetCore.Mvc;

namespace App.Controllers;

public class AccountController : Controller
{
    [HttpPost]
    public IActionResult Login(LoginModel model, string returnUrl)
    {
        if (Url.IsLocalUrl(returnUrl))
        {
            return Redirect(returnUrl);
        }
        return Redirect("/dashboard");
    }

    [HttpPost]
    public IActionResult Logout(string returnUrl)
    {
        return LocalRedirect(returnUrl);
    }
}
`, 'user-input-in-redirect')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// security/deterministic/user-input-in-path
// ---------------------------------------------------------------------------

describe('security/deterministic/user-input-in-path (C#)', () => {
  it('detects a controller action reading a file from a request parameter', () => {
    const found = matches(`using Microsoft.AspNetCore.Mvc;

namespace App.Controllers;

public class DocumentsController : ControllerBase
{
    private readonly string _root = "/srv/documents";

    [HttpGet]
    public IActionResult Download(string fileName)
    {
        var bytes = System.IO.File.ReadAllBytes(Path.Combine(_root, fileName));
        return File(bytes, "application/octet-stream");
    }
}
`, 'user-input-in-path')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag Path.GetFileName-sanitized input or non-request file access', () => {
    const found = matches(`using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace App.Controllers;

public class UploadsController : ControllerBase
{
    private readonly string _root = "/srv/uploads";

    [HttpPost]
    public async Task<IActionResult> Save(IFormFile upload)
    {
        var safePath = Path.Combine(_root, Path.GetFileName(upload.FileName));
        await using var stream = System.IO.File.Create(Path.Combine(_root, Path.GetFileName(upload.FileName)));
        await upload.CopyToAsync(stream);
        return Ok(safePath);
    }
}

public class ConfigLoader
{
    public string Load(string configPath)
    {
        return System.IO.File.ReadAllText(configPath);
    }
}
`, 'user-input-in-path')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// security/deterministic/unsafe-unzip
// ---------------------------------------------------------------------------

describe('security/deterministic/unsafe-unzip (C#)', () => {
  it('detects zip-slip extraction from entry.FullName', () => {
    const found = matches(`using System.IO.Compression;

namespace App.Import;

public class ArchiveImporter
{
    public void Extract(string zipPath, string destination)
    {
        using var archive = ZipFile.OpenRead(zipPath);
        foreach (var entry in archive.Entries)
        {
            entry.ExtractToFile(Path.Combine(destination, entry.FullName), overwrite: true);
        }
    }
}
`, 'unsafe-unzip')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag containment-checked extraction or ExtractToDirectory', () => {
    const found = matches(`using System.IO.Compression;

namespace App.Import;

public class ArchiveImporter
{
    public void Extract(string zipPath, string destination)
    {
        using var archive = ZipFile.OpenRead(zipPath);
        foreach (var entry in archive.Entries)
        {
            var target = Path.GetFullPath(Path.Combine(destination, entry.FullName));
            if (!target.StartsWith(Path.GetFullPath(destination), StringComparison.Ordinal))
            {
                throw new InvalidDataException("Entry escapes destination");
            }
            entry.ExtractToFile(target, overwrite: true);
        }
    }

    public void ExtractAll(string zipPath, string destination)
    {
        ZipFile.ExtractToDirectory(zipPath, destination);
    }
}
`, 'unsafe-unzip')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// security/deterministic/mixed-http-methods
// ---------------------------------------------------------------------------

describe('security/deterministic/mixed-http-methods (C#)', () => {
  it('detects an action with both [HttpGet] and [HttpPost]', () => {
    const found = matches(`using Microsoft.AspNetCore.Mvc;

namespace App.Controllers;

public class SearchController : Controller
{
    [HttpGet]
    [HttpPost]
    public IActionResult Search(string query)
    {
        return View();
    }
}
`, 'mixed-http-methods')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag single-method actions', () => {
    const found = matches(`using Microsoft.AspNetCore.Mvc;

namespace App.Controllers;

public class SearchController : Controller
{
    [HttpGet]
    public IActionResult Search(string query)
    {
        return View();
    }

    [HttpPost]
    public IActionResult SaveSearch(string query)
    {
        return RedirectToAction(nameof(Search));
    }
}
`, 'mixed-http-methods')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// security/deterministic/bind-all-interfaces
// ---------------------------------------------------------------------------

describe('security/deterministic/bind-all-interfaces (C#)', () => {
  it('detects 0.0.0.0 URLs and IPAddress.Any listeners', () => {
    const found = matches(`using Microsoft.AspNetCore.Builder;
using System.Net;
using System.Net.Sockets;

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.UseUrls("http://0.0.0.0:8080");
var app = builder.Build();

var listener = new TcpListener(IPAddress.Any, 9000);
listener.Start();

app.Run();
`, 'bind-all-interfaces')
    expect(found.length).toBeGreaterThanOrEqual(2)
  })

  it('does not flag localhost binding', () => {
    const found = matches(`using Microsoft.AspNetCore.Builder;
using System.Net;
using System.Net.Sockets;

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.UseUrls("http://localhost:5000");
var app = builder.Build();

var listener = new TcpListener(IPAddress.Loopback, 9000);
listener.Start();

app.Run();
`, 'bind-all-interfaces')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// security/deterministic/unsafe-xml-signature
// ---------------------------------------------------------------------------

describe('security/deterministic/unsafe-xml-signature (C#)', () => {
  it('detects CheckSignature() with no key', () => {
    const found = matches(`using System.Security.Cryptography.Xml;
using System.Xml;

namespace App.Saml;

public class AssertionValidator
{
    public bool Validate(XmlDocument document)
    {
        var signedXml = new SignedXml(document);
        signedXml.LoadXml((XmlElement)document.GetElementsByTagName("Signature")[0]!);
        return signedXml.CheckSignature();
    }
}
`, 'unsafe-xml-signature')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag CheckSignature with an explicit trusted key', () => {
    const found = matches(`using System.Security.Cryptography;
using System.Security.Cryptography.Xml;
using System.Xml;

namespace App.Saml;

public class AssertionValidator
{
    public bool Validate(XmlDocument document, RSA trustedKey)
    {
        var signedXml = new SignedXml(document);
        signedXml.LoadXml((XmlElement)document.GetElementsByTagName("Signature")[0]!);
        return signedXml.CheckSignature(trustedKey);
    }
}
`, 'unsafe-xml-signature')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// security/deterministic/ssh-no-host-key-verification
// ---------------------------------------------------------------------------

describe('security/deterministic/ssh-no-host-key-verification (C#)', () => {
  it('detects an unconditional CanTrust = true handler', () => {
    const found = matches(`using Renci.SshNet;

namespace App.Deploy;

public class SftpUploader
{
    public void Upload(string host, string user, string keyFile)
    {
        using var client = new SftpClient(host, user, new PrivateKeyFile(keyFile));
        client.HostKeyReceived += (sender, e) => { e.CanTrust = true; };
        client.Connect();
    }
}
`, 'ssh-no-host-key-verification')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag fingerprint-verified host keys', () => {
    const found = matches(`using Renci.SshNet;

namespace App.Deploy;

public class SftpUploader
{
    private readonly byte[] _expectedFingerprint;

    public void Upload(string host, string user, string keyFile)
    {
        using var client = new SftpClient(host, user, new PrivateKeyFile(keyFile));
        client.HostKeyReceived += (sender, e) =>
        {
            e.CanTrust = e.FingerPrint.SequenceEqual(_expectedFingerprint);
        };
        client.Connect();
    }
}
`, 'ssh-no-host-key-verification')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// security/deterministic/unrestricted-file-upload
// ---------------------------------------------------------------------------

describe('security/deterministic/unrestricted-file-upload (C#)', () => {
  it('detects [DisableRequestSizeLimit] on an upload action', () => {
    const found = matches(`using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace App.Controllers;

public class UploadsController : ControllerBase
{
    [HttpPost]
    [DisableRequestSizeLimit]
    public async Task<IActionResult> Upload(IFormFile file)
    {
        await using var stream = System.IO.File.Create("/srv/uploads/incoming.bin");
        await file.CopyToAsync(stream);
        return Ok();
    }
}
`, 'unrestricted-file-upload')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag uploads with an explicit size limit', () => {
    const found = matches(`using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace App.Controllers;

public class UploadsController : ControllerBase
{
    [HttpPost]
    [RequestSizeLimit(10_000_000)]
    public async Task<IActionResult> Upload(IFormFile file)
    {
        await using var stream = System.IO.File.Create("/srv/uploads/incoming.bin");
        await file.CopyToAsync(stream);
        return Ok();
    }
}
`, 'unrestricted-file-upload')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// security/deterministic/file-permissions-world-accessible
// ---------------------------------------------------------------------------

describe('security/deterministic/file-permissions-world-accessible (C#)', () => {
  it('detects UnixFileMode.OtherWrite', () => {
    const found = matches(`namespace App.Export;

public class ReportWriter
{
    public void Publish(string path)
    {
        File.SetUnixFileMode(path,
            UnixFileMode.UserRead | UnixFileMode.UserWrite |
            UnixFileMode.GroupRead | UnixFileMode.OtherRead | UnixFileMode.OtherWrite);
    }
}
`, 'file-permissions-world-accessible')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag 644-style permissions', () => {
    const found = matches(`namespace App.Export;

public class ReportWriter
{
    public void Publish(string path)
    {
        File.SetUnixFileMode(path,
            UnixFileMode.UserRead | UnixFileMode.UserWrite |
            UnixFileMode.GroupRead | UnixFileMode.OtherRead);
    }
}
`, 'file-permissions-world-accessible')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// security/deterministic/snmp-insecure-version
// ---------------------------------------------------------------------------

describe('security/deterministic/snmp-insecure-version (C#)', () => {
  it('detects SNMP v1', () => {
    const found = matches(`using Lextm.SharpSnmpLib;
using Lextm.SharpSnmpLib.Messaging;
using System.Net;

namespace App.Monitoring;

public class SnmpPoller
{
    public IList<Variable> Poll(IPEndPoint device)
    {
        return Messenger.Get(VersionCode.V1, device, new OctetString("public"),
            new List<Variable> { new Variable(new ObjectIdentifier("1.3.6.1.2.1.1.1.0")) }, 5000);
    }
}
`, 'snmp-insecure-version')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag SNMP v3', () => {
    const found = matches(`using Lextm.SharpSnmpLib;
using Lextm.SharpSnmpLib.Messaging;
using System.Net;

namespace App.Monitoring;

public class SnmpPoller
{
    public ISnmpMessage Discover(IPEndPoint device)
    {
        var discovery = Messenger.GetNextDiscovery(SnmpType.GetRequestPdu);
        return discovery.GetResponse(5000, device);
    }

    public VersionCode Version => VersionCode.V3;
}
`, 'snmp-insecure-version')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// security/deterministic/snmp-weak-crypto
// ---------------------------------------------------------------------------

describe('security/deterministic/snmp-weak-crypto (C#)', () => {
  it('detects MD5 authentication and DES privacy providers', () => {
    const found = matches(`using Lextm.SharpSnmpLib;
using Lextm.SharpSnmpLib.Security;

namespace App.Monitoring;

public class SnmpV3Session
{
    public IPrivacyProvider BuildProvider(string authPass, string privPass)
    {
        return new DESPrivacyProvider(new OctetString(privPass), new MD5AuthenticationProvider(new OctetString(authPass)));
    }
}
`, 'snmp-weak-crypto')
    expect(found.length).toBeGreaterThanOrEqual(2)
  })

  it('does not flag SHA-256 + AES providers', () => {
    const found = matches(`using Lextm.SharpSnmpLib;
using Lextm.SharpSnmpLib.Security;

namespace App.Monitoring;

public class SnmpV3Session
{
    public IPrivacyProvider BuildProvider(string authPass, string privPass)
    {
        return new AESPrivacyProvider(new OctetString(privPass), new SHA256AuthenticationProvider(new OctetString(authPass)));
    }
}
`, 'snmp-weak-crypto')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// security/deterministic/redos-vulnerable-regex-python (C# port)
// ---------------------------------------------------------------------------

describe('security/deterministic/redos-vulnerable-regex-python (C#)', () => {
  it('detects nested quantifiers in new Regex()', () => {
    const found = matches(`using System.Text.RegularExpressions;

namespace App.Validation;

public class UsernameValidator
{
    private static readonly Regex Pattern = new Regex(@"^([a-zA-Z0-9]+)*$");

    public bool IsValid(string candidate)
    {
        return Pattern.IsMatch(candidate);
    }
}
`, 'redos-vulnerable-regex-python')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag linear patterns or NonBacktracking regexes', () => {
    const found = matches(`using System.Text.RegularExpressions;

namespace App.Validation;

public class EmailValidator
{
    private static readonly Regex Email = new Regex(@"^[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,}$");
    private static readonly Regex Repeats = new Regex(@"^([a-zA-Z0-9]+)*$", RegexOptions.NonBacktracking);

    public bool IsValid(string candidate)
    {
        return Email.IsMatch(candidate) && Repeats.IsMatch(candidate);
    }
}
`, 'redos-vulnerable-regex-python')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// security/deterministic/ip-forwarding
// ---------------------------------------------------------------------------

describe('security/deterministic/ip-forwarding (C#)', () => {
  it('detects reading X-Forwarded-For directly', () => {
    const found = matches(`using Microsoft.AspNetCore.Mvc;

namespace App.Controllers;

public class AuditController : ControllerBase
{
    [HttpGet]
    public IActionResult WhoAmI()
    {
        var clientIp = Request.Headers["X-Forwarded-For"].ToString();
        return Ok(clientIp);
    }
}
`, 'ip-forwarding')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag other headers or RemoteIpAddress', () => {
    const found = matches(`using Microsoft.AspNetCore.Mvc;

namespace App.Controllers;

public class AuditController : ControllerBase
{
    [HttpGet]
    public IActionResult WhoAmI()
    {
        var agent = Request.Headers["User-Agent"].ToString();
        var ip = HttpContext.Connection.RemoteIpAddress?.ToString();
        return Ok(new { agent, ip });
    }
}
`, 'ip-forwarding')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// security/deterministic/hardcoded-password-function-arg
// ---------------------------------------------------------------------------

describe('security/deterministic/hardcoded-password-function-arg (C#)', () => {
  it('detects a literal passed to an authenticate call', () => {
    const found = matches(`using MailKit.Net.Smtp;

namespace App.Notifications;

public class MailSender
{
    public async Task Send(SmtpClient client)
    {
        await client.AuthenticateAsync("notifications", "NotAR3alPassword!");
    }
}
`, 'hardcoded-password-function-arg')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('detects new NetworkCredential with a literal password', () => {
    const found = matches(`using System.Net;

namespace App.Integrations;

public class ProxyConfig
{
    public ICredentials BuildCredentials()
    {
        return new NetworkCredential("svc-proxy", "Pr0xyP@ss");
    }
}
`, 'hardcoded-password-function-arg')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag credentials loaded from configuration', () => {
    const found = matches(`using MailKit.Net.Smtp;
using Microsoft.Extensions.Configuration;
using System.Net;

namespace App.Notifications;

public class MailSender
{
    private readonly IConfiguration _config;

    public async Task Send(SmtpClient client)
    {
        await client.AuthenticateAsync(_config["Smtp:User"], _config["Smtp:Password"]);
        var credential = new NetworkCredential(_config["Proxy:User"], _config["Proxy:Password"]);
    }
}
`, 'hardcoded-password-function-arg')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// security/deterministic/publicly-writable-directory
// ---------------------------------------------------------------------------

describe('security/deterministic/publicly-writable-directory (C#)', () => {
  it('detects writing to a fixed /tmp path', () => {
    const found = matches(`namespace App.Export;

public class CsvExporter
{
    public void Export(string payload)
    {
        File.WriteAllText("/tmp/app-export.csv", payload);
    }
}
`, 'publicly-writable-directory')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag unique temp files via Path.GetTempPath()', () => {
    const found = matches(`namespace App.Export;

public class CsvExporter
{
    public string Export(string payload)
    {
        var path = Path.Combine(Path.GetTempPath(), $"{Guid.NewGuid():N}.csv");
        File.WriteAllText(path, payload);
        return path;
    }
}
`, 'publicly-writable-directory')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// security/deterministic/long-term-aws-keys-in-code
// ---------------------------------------------------------------------------

describe('security/deterministic/long-term-aws-keys-in-code (C#)', () => {
  it('detects a hardcoded AKIA access key', () => {
    const found = matches(`using Amazon.S3;

namespace App.Storage;

public class S3ClientFactory
{
    public AmazonS3Client Create()
    {
        var accessKey = "AKIAIOSFODNN7EXAMPLE";
        var secretKey = Environment.GetEnvironmentVariable("AWS_SECRET_ACCESS_KEY");
        return new AmazonS3Client(accessKey, secretKey);
    }
}
`, 'long-term-aws-keys-in-code')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag keys loaded from the environment', () => {
    const found = matches(`using Amazon.S3;

namespace App.Storage;

public class S3ClientFactory
{
    public AmazonS3Client Create()
    {
        var accessKey = Environment.GetEnvironmentVariable("AWS_ACCESS_KEY_ID");
        var secretKey = Environment.GetEnvironmentVariable("AWS_SECRET_ACCESS_KEY");
        return new AmazonS3Client(accessKey, secretKey);
    }
}
`, 'long-term-aws-keys-in-code')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// security/deterministic/s3-insecure-http
// ---------------------------------------------------------------------------

describe('security/deterministic/s3-insecure-http (C#)', () => {
  it('detects an http:// S3 ServiceURL', () => {
    const found = matches(`using Amazon.S3;

namespace App.Storage;

public class S3ClientFactory
{
    public AmazonS3Client Create()
    {
        var config = new AmazonS3Config
        {
            ServiceURL = "http://s3.storage.example.com",
            ForcePathStyle = true,
        };
        return new AmazonS3Client(config);
    }
}
`, 's3-insecure-http')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag https endpoints or localhost dev endpoints', () => {
    const found = matches(`using Amazon.S3;

namespace App.Storage;

public class S3ClientFactory
{
    public AmazonS3Client Create(bool local)
    {
        var config = new AmazonS3Config
        {
            ServiceURL = local ? "http://localhost:9000" : "https://s3.eu-west-1.amazonaws.com",
            ForcePathStyle = true,
        };
        return new AmazonS3Client(config);
    }
}
`, 's3-insecure-http')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// security/deterministic/use-of-dsa
// ---------------------------------------------------------------------------

describe('security/deterministic/use-of-dsa (C#)', () => {
  it('detects DSA.Create() and the DSACryptoServiceProvider class', () => {
    const f1 = matches(`using System.Security.Cryptography;

namespace App.Crypto;

public class Signer
{
    public DSA Build() => DSA.Create();
}
`, 'use-of-dsa')
    expect(f1.length).toBeGreaterThanOrEqual(1)

    const f2 = matches(`using System.Security.Cryptography;

namespace App.Crypto;

public class LegacySigner
{
    public DSACryptoServiceProvider Build() => new DSACryptoServiceProvider();
}
`, 'use-of-dsa')
    expect(f2.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag RSA or ECDSA', () => {
    const found = matches(`using System.Security.Cryptography;

namespace App.Crypto;

public class Signer
{
    public RSA Rsa() => RSA.Create();
    public ECDsa Ecdsa() => ECDsa.Create();
}
`, 'use-of-dsa')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// security/deterministic/use-of-xsltransform
// ---------------------------------------------------------------------------

describe('security/deterministic/use-of-xsltransform (C#)', () => {
  it('detects new XslTransform()', () => {
    const found = matches(`using System.Xml.Xsl;

namespace App.Xml;

public class Renderer
{
    public XslTransform Build() => new XslTransform();
}
`, 'use-of-xsltransform')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag XslCompiledTransform', () => {
    const found = matches(`using System.Xml.Xsl;

namespace App.Xml;

public class Renderer
{
    public XslCompiledTransform Build() => new XslCompiledTransform();
}
`, 'use-of-xsltransform')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// security/deterministic/custom-crypto-algorithm
// ---------------------------------------------------------------------------

describe('security/deterministic/custom-crypto-algorithm (C#)', () => {
  it('detects a class deriving from HashAlgorithm', () => {
    const found = matches(`using System.Security.Cryptography;

namespace App.Crypto;

public sealed class MyDigest : HashAlgorithm
{
    public override void Initialize() { }
    protected override void HashCore(byte[] array, int ibStart, int cbSize) { }
    protected override byte[] HashFinal() => System.Array.Empty<byte>();
}
`, 'custom-crypto-algorithm')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('detects a class deriving from SymmetricAlgorithm', () => {
    const found = matches(`using System.Security.Cryptography;

namespace App.Crypto;

public sealed class MyCipher : SymmetricAlgorithm
{
    public override ICryptoTransform CreateEncryptor(byte[] key, byte[] iv) => null;
    public override ICryptoTransform CreateDecryptor(byte[] key, byte[] iv) => null;
    public override void GenerateKey() { }
    public override void GenerateIV() { }
}
`, 'custom-crypto-algorithm')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag a class using a standard algorithm without deriving from a crypto type', () => {
    const found = matches(`using System.Security.Cryptography;

namespace App.Crypto;

public sealed class Hasher
{
    public byte[] Hash(byte[] data) => SHA256.HashData(data);
}
`, 'custom-crypto-algorithm')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// security/deterministic/hardcoded-securityprotocoltype
// ---------------------------------------------------------------------------

describe('security/deterministic/hardcoded-securityprotocoltype (C#)', () => {
  it('detects a pinned SecurityProtocolType value', () => {
    const found = matches(`using System.Net;

namespace App.Net;

public class HttpSetup
{
    public void Configure()
    {
        ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
    }
}
`, 'hardcoded-securityprotocoltype')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag deprecated values (the weak-ssl rule) or comparisons', () => {
    const found = matches(`using System.Net;

namespace App.Net;

public class HttpSetup
{
    public bool IsLegacy(SecurityProtocolType p) => p == SecurityProtocolType.Tls12;
}
`, 'hardcoded-securityprotocoltype')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// security/deterministic/hardcoded-sslprotocols
// ---------------------------------------------------------------------------

describe('security/deterministic/hardcoded-sslprotocols (C#)', () => {
  it('detects a pinned SslProtocols value', () => {
    const found = matches(`using System.Net.Security;
using System.Security.Authentication;

namespace App.Net;

public class TlsClient
{
    public void Connect(SslStream stream, string host)
    {
        stream.AuthenticateAsClient(host, null, SslProtocols.Tls13, false);
    }
}
`, 'hardcoded-sslprotocols')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag SslProtocols.None (OS default) or comparisons', () => {
    const found = matches(`using System.Security.Authentication;

namespace App.Net;

public class TlsClient
{
    public SslProtocols Default => SslProtocols.None;
    public bool Modern(SslProtocols p) => p == SslProtocols.Tls13;
}
`, 'hardcoded-sslprotocols')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// security/deterministic/predictable-cipher-iv
// ---------------------------------------------------------------------------

describe('security/deterministic/predictable-cipher-iv (C#)', () => {
  it('detects a zero-filled IV assignment and a constant IV argument', () => {
    const f1 = matches(`using System.Security.Cryptography;

namespace App.Crypto;

public class Cipher
{
    public void Setup(Aes aes)
    {
        aes.IV = new byte[16];
    }
}
`, 'predictable-cipher-iv')
    expect(f1.length).toBeGreaterThanOrEqual(1)

    const f2 = matches(`using System.Security.Cryptography;

namespace App.Crypto;

public class Cipher
{
    public ICryptoTransform Make(Aes aes, byte[] key)
    {
        return aes.CreateEncryptor(key, new byte[] { 0x00, 0x00, 0x00, 0x00 });
    }
}
`, 'predictable-cipher-iv')
    expect(f2.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag a randomly generated IV', () => {
    const found = matches(`using System.Security.Cryptography;

namespace App.Crypto;

public class Cipher
{
    public void Setup(Aes aes)
    {
        aes.GenerateIV();
        var freshIv = RandomNumberGenerator.GetBytes(16);
        aes.IV = freshIv;
    }
}
`, 'predictable-cipher-iv')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// security/deterministic/predictable-random-seed
// ---------------------------------------------------------------------------

describe('security/deterministic/predictable-random-seed (C#)', () => {
  it('detects a constant seed via constructor and SetSeed', () => {
    const f1 = matches(`using Org.BouncyCastle.Security;

namespace App.Crypto;

public class Tokens
{
    public SecureRandom Build() => new SecureRandom(new byte[] { 0x01, 0x02 });
}
`, 'predictable-random-seed')
    expect(f1.length).toBeGreaterThanOrEqual(1)

    const f2 = matches(`using Org.BouncyCastle.Security;

namespace App.Crypto;

public class Tokens
{
    public void Seed(SecureRandom r) => r.SetSeed(424242);
}
`, 'predictable-random-seed')
    expect(f2.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag a self-seeded generator', () => {
    const found = matches(`using Org.BouncyCastle.Security;

namespace App.Crypto;

public class Tokens
{
    public SecureRandom Build() => new SecureRandom();
}
`, 'predictable-random-seed')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// security/deterministic/mutable-public-static-field
// ---------------------------------------------------------------------------

describe('security/deterministic/mutable-public-static-field (C#)', () => {
  it('detects a public static array and a public static List field', () => {
    const f1 = matches(`namespace App.Config;

public static class Defaults
{
    public static readonly string[] Origins = { "a", "b" };
}
`, 'mutable-public-static-field')
    expect(f1.length).toBeGreaterThanOrEqual(1)

    const f2 = matches(`using System.Collections.Generic;

namespace App.Config;

public static class Defaults
{
    public static List<string> Allowed = new();
}
`, 'mutable-public-static-field')
    expect(f2.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag const, private, or immutable-typed fields', () => {
    const found = matches(`using System.Collections.Immutable;

namespace App.Config;

public static class Defaults
{
    public const int MaxRetries = 3;
    private static readonly byte[] Salt = new byte[16];
    public static readonly ImmutableArray<string> Origins = ImmutableArray<string>.Empty;
}
`, 'mutable-public-static-field')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// security/deterministic/reflection-bypass-accessibility
// ---------------------------------------------------------------------------

describe('security/deterministic/reflection-bypass-accessibility (C#)', () => {
  it('detects BindingFlags.NonPublic used to read a private field', () => {
    const found = matches(`using System;
using System.Reflection;

namespace App.Reflect;

public class Probe
{
    public object? Read(object target, string name)
    {
        var f = target.GetType().GetField(name, BindingFlags.NonPublic | BindingFlags.Instance);
        return f?.GetValue(target);
    }
}
`, 'reflection-bypass-accessibility')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag public-only reflection', () => {
    const found = matches(`using System.Reflection;

namespace App.Reflect;

public class Probe
{
    public object? Read(object target, string name)
    {
        var f = target.GetType().GetField(name, BindingFlags.Public | BindingFlags.Instance);
        return f?.GetValue(target);
    }
}
`, 'reflection-bypass-accessibility')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// security/deterministic/unsafe-code-block
// ---------------------------------------------------------------------------

describe('security/deterministic/unsafe-code-block (C#)', () => {
  it('detects an unsafe method modifier and an unsafe block', () => {
    const f1 = matches(`namespace App.Native;

public class Buffers
{
    public unsafe int First(byte[] data)
    {
        fixed (byte* p = data) { return *p; }
    }
}
`, 'unsafe-code-block')
    expect(f1.length).toBeGreaterThanOrEqual(1)

    const f2 = matches(`namespace App.Native;

public class Buffers
{
    public int First(byte[] data)
    {
        unsafe
        {
            fixed (byte* p = data) { return *p; }
        }
    }
}
`, 'unsafe-code-block')
    expect(f2.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag safe code with an unrelated async modifier', () => {
    const found = matches(`using System.Threading.Tasks;

namespace App.Native;

public class Buffers
{
    public async Task<int> FirstAsync(byte[] data)
    {
        await Task.Yield();
        return data.Length;
    }
}
`, 'unsafe-code-block')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// security/deterministic/pinvoke-publicly-visible
// ---------------------------------------------------------------------------

describe('security/deterministic/pinvoke-publicly-visible (C#)', () => {
  it('detects a public [DllImport] method', () => {
    const found = matches(`using System;
using System.Runtime.InteropServices;

namespace App.Native;

public static class Win32
{
    [DllImport("kernel32.dll")]
    public static extern bool CloseHandle(IntPtr handle);
}
`, 'pinvoke-publicly-visible')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag a private/internal P/Invoke', () => {
    const found = matches(`using System;
using System.Runtime.InteropServices;

namespace App.Native;

internal static class Win32
{
    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr handle);
}
`, 'pinvoke-publicly-visible')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// security/deterministic/visible-event-handler
// ---------------------------------------------------------------------------

describe('security/deterministic/visible-event-handler (C#)', () => {
  it('detects a public event-handler-signature method', () => {
    const found = matches(`using System;

namespace App.Ui;

public class Page
{
    public void OnLoad(object sender, EventArgs e)
    {
        System.Console.WriteLine("loaded");
    }
}
`, 'visible-event-handler')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag a private handler or a normal public method', () => {
    const found = matches(`using System;

namespace App.Ui;

public class Page
{
    private void OnLoad(object sender, EventArgs e) { System.Console.WriteLine("x"); }
    public int Add(object a, object b) => 0;
}
`, 'visible-event-handler')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// security/deterministic/schannel-strong-crypto-disabled
// ---------------------------------------------------------------------------

describe('security/deterministic/schannel-strong-crypto-disabled (C#)', () => {
  it('detects the DontEnableSchUseStrongCrypto switch set to true', () => {
    const found = matches(`using System;

namespace App.Net;

public class Startup
{
    public void Configure()
    {
        AppContext.SetSwitch("Switch.System.Net.DontEnableSchUseStrongCrypto", true);
    }
}
`, 'schannel-strong-crypto-disabled')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag the switch set to false or an unrelated switch', () => {
    const found = matches(`using System;

namespace App.Net;

public class Startup
{
    public void Configure()
    {
        AppContext.SetSwitch("Switch.System.Net.DontEnableSchUseStrongCrypto", false);
        AppContext.SetSwitch("Switch.System.SomethingElse", true);
    }
}
`, 'schannel-strong-crypto-disabled')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// security/deterministic/servicepointmanager-protocols-disabled
// ---------------------------------------------------------------------------

describe('security/deterministic/servicepointmanager-protocols-disabled (C#)', () => {
  it('detects the DisableUsingServicePointManagerSecurityProtocols switch set to true', () => {
    const found = matches(`using System;

namespace App.Net;

public class Startup
{
    public void Configure()
    {
        AppContext.SetSwitch("Switch.System.ServiceModel.DisableUsingServicePointManagerSecurityProtocols", true);
    }
}
`, 'servicepointmanager-protocols-disabled')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag the switch set to false', () => {
    const found = matches(`using System;

namespace App.Net;

public class Startup
{
    public void Configure()
    {
        AppContext.SetSwitch("Switch.System.ServiceModel.DisableUsingServicePointManagerSecurityProtocols", false);
    }
}
`, 'servicepointmanager-protocols-disabled')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// security/deterministic/http-header-checking-disabled
// ---------------------------------------------------------------------------

describe('security/deterministic/http-header-checking-disabled (C#)', () => {
  it('detects EnableHeaderChecking = false via assignment and initializer', () => {
    const f1 = matches(`using System.Web.Configuration;

namespace App.Web;

public class Setup
{
    public void Configure(HttpRuntimeSection section)
    {
        section.EnableHeaderChecking = false;
    }
}
`, 'http-header-checking-disabled')
    expect(f1.length).toBeGreaterThanOrEqual(1)

    const f2 = matches(`using System.Web.Configuration;

namespace App.Web;

public class Setup
{
    public HttpRuntimeSection Build() => new HttpRuntimeSection { EnableHeaderChecking = false };
}
`, 'http-header-checking-disabled')
    expect(f2.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag EnableHeaderChecking left enabled', () => {
    const found = matches(`using System.Web.Configuration;

namespace App.Web;

public class Setup
{
    public void Configure(HttpRuntimeSection section)
    {
        section.EnableHeaderChecking = true;
    }
}
`, 'http-header-checking-disabled')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// security/deterministic/unmanaged-pointer-visible
// ---------------------------------------------------------------------------

describe('security/deterministic/unmanaged-pointer-visible (C#)', () => {
  it('detects a public IntPtr field and a public IntPtr property', () => {
    const f1 = matches(`using System;

namespace App.Native;

public class Handle
{
    public IntPtr Raw;
}
`, 'unmanaged-pointer-visible')
    expect(f1.length).toBeGreaterThanOrEqual(1)

    const f2 = matches(`using System;

namespace App.Native;

public class Handle
{
    public IntPtr Raw { get; set; }
}
`, 'unmanaged-pointer-visible')
    expect(f2.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag a private pointer or a public SafeHandle', () => {
    const found = matches(`using System;
using Microsoft.Win32.SafeHandles;

namespace App.Native;

public class Handle
{
    private IntPtr _raw;
    public SafeFileHandle File { get; set; }
}
`, 'unmanaged-pointer-visible')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// security/deterministic/add-cert-to-root-store
// ---------------------------------------------------------------------------

describe('security/deterministic/add-cert-to-root-store (C#)', () => {
  it('detects opening the Root store', () => {
    const found = matches(`using System.Security.Cryptography.X509Certificates;

namespace App.Certs;

public class Trust
{
    public X509Store Open() => new X509Store(StoreName.Root, StoreLocation.LocalMachine);
}
`, 'add-cert-to-root-store')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag opening the personal (My) store', () => {
    const found = matches(`using System.Security.Cryptography.X509Certificates;

namespace App.Certs;

public class Trust
{
    public X509Store Open() => new X509Store(StoreName.My, StoreLocation.CurrentUser);
}
`, 'add-cert-to-root-store')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// security/deterministic/ldap-anonymous-bind
// ---------------------------------------------------------------------------

describe('security/deterministic/ldap-anonymous-bind (C#)', () => {
  it('detects AuthenticationTypes.Anonymous on a DirectoryEntry', () => {
    const f1 = matches(`using System.DirectoryServices;

namespace App.Directory;

public class Ad
{
    public DirectoryEntry Connect(string path)
        => new DirectoryEntry(path, null, null, AuthenticationTypes.Anonymous);
}
`, 'ldap-anonymous-bind')
    expect(f1.length).toBeGreaterThanOrEqual(1)

    const f2 = matches(`using System.DirectoryServices;

namespace App.Directory;

public class Ad
{
    public void Configure(DirectoryEntry entry)
    {
        entry.AuthenticationType = AuthenticationTypes.Anonymous;
    }
}
`, 'ldap-anonymous-bind')
    expect(f2.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag a secure authenticated bind', () => {
    const found = matches(`using System.DirectoryServices;

namespace App.Directory;

public class Ad
{
    public DirectoryEntry Connect(string path, string user, string pass)
        => new DirectoryEntry(path, user, pass, AuthenticationTypes.Secure);
}
`, 'ldap-anonymous-bind')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// security/deterministic/account-shared-access-signature (wave 3)
// ---------------------------------------------------------------------------

describe('security/deterministic/account-shared-access-signature (C#)', () => {
  it('detects an account SAS minted from a storage account', () => {
    const found = matches(`using Microsoft.Azure.Storage;

namespace App.Storage;

public class TokenIssuer
{
    public string Issue(CloudStorageAccount storageAccount, SharedAccessAccountPolicy policy)
        => storageAccount.GetSharedAccessSignature(policy);
}
`, 'account-shared-access-signature')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag a container/blob service SAS', () => {
    const found = matches(`using Microsoft.Azure.Storage.Blob;

namespace App.Storage;

public class TokenIssuer
{
    public string Issue(CloudBlockBlob blob, SharedAccessBlobPolicy policy)
        => blob.GetSharedAccessSignature(policy);
}
`, 'account-shared-access-signature')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// security/deterministic/catch-corrupted-state-exception (wave 3)
// ---------------------------------------------------------------------------

describe('security/deterministic/catch-corrupted-state-exception (C#)', () => {
  it('detects [HandleProcessCorruptedStateExceptions] on a method', () => {
    const found = matches(`using System;
using System.Runtime.ExceptionServices;

namespace App.Interop;

public class NativeBridge
{
    [HandleProcessCorruptedStateExceptions]
    public void Invoke()
    {
        try { } catch (Exception) { }
    }
}
`, 'catch-corrupted-state-exception')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag an ordinary try/catch', () => {
    const found = matches(`using System;

namespace App.Interop;

public class NativeBridge
{
    public void Invoke()
    {
        try { } catch (Exception) { }
    }
}
`, 'catch-corrupted-state-exception')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// security/deterministic/command-resolved-from-path (wave 3)
// ---------------------------------------------------------------------------

describe('security/deterministic/command-resolved-from-path (C#)', () => {
  it('detects launching a bare executable name', () => {
    const f1 = matches(`using System.Diagnostics;

namespace App.Ops;

public class Runner
{
    public void Run() => Process.Start("regsvr32.exe");
}
`, 'command-resolved-from-path')
    expect(f1.length).toBeGreaterThanOrEqual(1)

    const f2 = matches(`using System.Diagnostics;

namespace App.Ops;

public class Runner
{
    public void Configure(ProcessStartInfo info)
    {
        info.FileName = "tool.exe";
    }
}
`, 'command-resolved-from-path')
    expect(f2.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag an absolute path', () => {
    const found = matches(`using System.Diagnostics;

namespace App.Ops;

public class Runner
{
    public void Run() => Process.Start(@"C:\\Windows\\System32\\regsvr32.exe");
}
`, 'command-resolved-from-path')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// security/deterministic/conflicting-transparency-annotations (wave 3)
// ---------------------------------------------------------------------------

describe('security/deterministic/conflicting-transparency-annotations (C#)', () => {
  it('detects SecurityCritical and SecuritySafeCritical on one method', () => {
    const found = matches(`using System.Security;

namespace App.Trust;

public class Worker
{
    [SecurityCritical]
    [SecuritySafeCritical]
    public void Run() { }
}
`, 'conflicting-transparency-annotations')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag a single transparency attribute', () => {
    const found = matches(`using System.Security;

namespace App.Trust;

public class Worker
{
    [SecurityCritical]
    public void Run() { }
}
`, 'conflicting-transparency-annotations')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// security/deterministic/createencryptor-non-default-iv (wave 3)
// ---------------------------------------------------------------------------

describe('security/deterministic/createencryptor-non-default-iv (C#)', () => {
  it('detects CreateEncryptor called with an explicit IV', () => {
    const found = matches(`using System.Security.Cryptography;

namespace App.Crypto;

public class Sealer
{
    public ICryptoTransform Make(Aes aes, byte[] key, byte[] iv)
        => aes.CreateEncryptor(key, iv);
}
`, 'createencryptor-non-default-iv')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag the parameterless CreateEncryptor', () => {
    const found = matches(`using System.Security.Cryptography;

namespace App.Crypto;

public class Sealer
{
    public ICryptoTransform Make(Aes aes)
        => aes.CreateEncryptor();
}
`, 'createencryptor-non-default-iv')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// security/deterministic/dataset-readxml-untrusted (wave 3)
// ---------------------------------------------------------------------------

describe('security/deterministic/dataset-readxml-untrusted (C#)', () => {
  it('detects DataSet.ReadXml', () => {
    const found = matches(`using System.Data;
using System.IO;

namespace App.Reports;

public class Loader
{
    public DataSet Load(string xml)
    {
        var dataSet = new DataSet();
        dataSet.ReadXml(new StringReader(xml));
        return dataSet;
    }
}
`, 'dataset-readxml-untrusted')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag WriteXml', () => {
    const found = matches(`using System.Data;
using System.IO;

namespace App.Reports;

public class Loader
{
    public void Save(DataSet dataSet, TextWriter writer) => dataSet.WriteXml(writer);
}
`, 'dataset-readxml-untrusted')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// security/deterministic/datatable-readxml-untrusted (wave 3)
// ---------------------------------------------------------------------------

describe('security/deterministic/datatable-readxml-untrusted (C#)', () => {
  it('detects DataTable.ReadXml', () => {
    const found = matches(`using System.Data;
using System.IO;

namespace App.Reports;

public class Loader
{
    public DataTable Load(string xml)
    {
        var dataTable = new DataTable();
        dataTable.ReadXml(new StringReader(xml));
        return dataTable;
    }
}
`, 'datatable-readxml-untrusted')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag a plain List.Add', () => {
    const found = matches(`using System.Collections.Generic;

namespace App.Reports;

public class Loader
{
    public void Add(List<string> table, string row) => table.Add(row);
}
`, 'datatable-readxml-untrusted')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// security/deterministic/hardcoded-certificate (wave 3)
// ---------------------------------------------------------------------------

describe('security/deterministic/hardcoded-certificate (C#)', () => {
  it('detects a certificate built from a byte-array literal', () => {
    const found = matches(`using System.Security.Cryptography.X509Certificates;

namespace App.Certs;

public class Loader
{
    public X509Certificate2 Get()
        => new X509Certificate2(new byte[] { 0x30, 0x82, 0x01, 0x0A });
}
`, 'hardcoded-certificate')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag loading from a file path', () => {
    const found = matches(`using System.Security.Cryptography.X509Certificates;

namespace App.Certs;

public class Loader
{
    public X509Certificate2 Get(string path) => new X509Certificate2(path);
}
`, 'hardcoded-certificate')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// security/deterministic/permissive-content-security-policy (wave 3)
// ---------------------------------------------------------------------------

describe('security/deterministic/permissive-content-security-policy (C#)', () => {
  it('detects unsafe-inline and wildcard CSP values', () => {
    const f1 = matches(`using Microsoft.AspNetCore.Http;

namespace App.Middleware;

public class SecurityHeaders
{
    public void Apply(HttpResponse response)
    {
        response.Headers["Content-Security-Policy"] = "default-src 'self'; script-src 'unsafe-inline'";
    }
}
`, 'permissive-content-security-policy')
    expect(f1.length).toBeGreaterThanOrEqual(1)

    const f2 = matches(`using Microsoft.AspNetCore.Http;

namespace App.Middleware;

public class SecurityHeaders
{
    public void Apply(HttpResponse response)
    {
        response.Headers.Add("Content-Security-Policy", "default-src *");
    }
}
`, 'permissive-content-security-policy')
    expect(f2.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag a restrictive policy', () => {
    const found = matches(`using Microsoft.AspNetCore.Http;

namespace App.Middleware;

public class SecurityHeaders
{
    public void Apply(HttpResponse response)
    {
        response.Headers["Content-Security-Policy"] = "default-src 'self'; object-src 'none'";
    }
}
`, 'permissive-content-security-policy')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// security/deterministic/insecure-xslt-script (wave 3)
// ---------------------------------------------------------------------------

describe('security/deterministic/insecure-xslt-script (C#)', () => {
  it('detects XsltSettings with script enabled', () => {
    const found = matches(`using System.Xml.Xsl;

namespace App.Xml;

public class TransformFactory
{
    public XsltSettings Build()
        => new XsltSettings(enableDocumentFunction: false, enableScript: true);
}
`, 'insecure-xslt-script')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag XsltSettings.Default', () => {
    const found = matches(`using System.Xml.Xsl;

namespace App.Xml;

public class TransformFactory
{
    public XsltSettings Build() => XsltSettings.Default;
}
`, 'insecure-xslt-script')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// security/deterministic/kdf-low-iteration-count (wave 3)
// ---------------------------------------------------------------------------

describe('security/deterministic/kdf-low-iteration-count (C#)', () => {
  it('detects Rfc2898DeriveBytes with too few iterations', () => {
    const found = matches(`using System.Security.Cryptography;

namespace App.Auth;

public class Hasher
{
    public byte[] Derive(byte[] password, byte[] salt)
    {
        using var kdf = new Rfc2898DeriveBytes(password, salt, 5000, HashAlgorithmName.SHA256);
        return kdf.GetBytes(32);
    }
}
`, 'kdf-low-iteration-count')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag a strong iteration count', () => {
    const found = matches(`using System.Security.Cryptography;

namespace App.Auth;

public class Hasher
{
    public byte[] Derive(byte[] password, byte[] salt)
    {
        using var kdf = new Rfc2898DeriveBytes(password, salt, 210000, HashAlgorithmName.SHA256);
        return kdf.GetBytes(32);
    }
}
`, 'kdf-low-iteration-count')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// security/deterministic/password-hash-unpredictable-salt (wave 3)
// ---------------------------------------------------------------------------

describe('security/deterministic/password-hash-unpredictable-salt (C#)', () => {
  it('detects a constant salt passed to Rfc2898DeriveBytes', () => {
    const found = matches(`using System.Security.Cryptography;

namespace App.Auth;

public class Hasher
{
    public byte[] Derive(string password)
    {
        using var kdf = new Rfc2898DeriveBytes(password, new byte[] { 1, 2, 3, 4, 5, 6, 7, 8 }, 210000);
        return kdf.GetBytes(32);
    }
}
`, 'password-hash-unpredictable-salt')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag a random per-password salt', () => {
    const found = matches(`using System.Security.Cryptography;

namespace App.Auth;

public class Hasher
{
    public byte[] Derive(string password)
    {
        var salt = RandomNumberGenerator.GetBytes(16);
        using var kdf = new Rfc2898DeriveBytes(password, salt, 210000);
        return kdf.GetBytes(32);
    }
}
`, 'password-hash-unpredictable-salt')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// security/deterministic/pinvoke-no-dllimportsearchpath (wave 3)
// ---------------------------------------------------------------------------

describe('security/deterministic/pinvoke-no-dllimportsearchpath (C#)', () => {
  it('detects a DllImport without DefaultDllImportSearchPaths', () => {
    const found = matches(`using System.Runtime.InteropServices;

namespace App.Interop;

internal static class Native
{
    [DllImport("metrics.dll")]
    internal static extern int Read(int slot);
}
`, 'pinvoke-no-dllimportsearchpath')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag a DllImport that constrains the search path', () => {
    const found = matches(`using System.Runtime.InteropServices;

namespace App.Interop;

internal static class Native
{
    [DllImport("metrics.dll")]
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    internal static extern int Read(int slot);
}
`, 'pinvoke-no-dllimportsearchpath')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// security/deterministic/pinvoke-string-marshalling-unspecified (wave 3)
// ---------------------------------------------------------------------------

describe('security/deterministic/pinvoke-string-marshalling-unspecified (C#)', () => {
  it('detects a string parameter with no CharSet or MarshalAs', () => {
    const found = matches(`using System.Runtime.InteropServices;

namespace App.Interop;

internal static class Native
{
    [DllImport("legacy.dll")]
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    internal static extern int Lookup(string key, out int handle);
}
`, 'pinvoke-string-marshalling-unspecified')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag when CharSet is specified', () => {
    const found = matches(`using System.Runtime.InteropServices;

namespace App.Interop;

internal static class Native
{
    [DllImport("legacy.dll", CharSet = CharSet.Unicode)]
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    internal static extern int Lookup(string key, out int handle);
}
`, 'pinvoke-string-marshalling-unspecified')
    expect(found).toHaveLength(0)
  })

  it('does not flag a non-string signature', () => {
    const found = matches(`using System.Runtime.InteropServices;

namespace App.Interop;

internal static class Native
{
    [DllImport("legacy.dll")]
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    internal static extern int Add(int a, int b);
}
`, 'pinvoke-string-marshalling-unspecified')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// security/deterministic/request-validation-disabled (wave 3)
// ---------------------------------------------------------------------------

describe('security/deterministic/request-validation-disabled (C#)', () => {
  it('detects [ValidateInput(false)] on an action', () => {
    const found = matches(`using Microsoft.AspNetCore.Mvc;

namespace App.Controllers;

public class FormsController : Controller
{
    [ValidateInput(false)]
    public IActionResult Submit(string body) => Ok(body);
}
`, 'request-validation-disabled')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag [ValidateInput(true)]', () => {
    const found = matches(`using Microsoft.AspNetCore.Mvc;

namespace App.Controllers;

public class FormsController : Controller
{
    [ValidateInput(true)]
    public IActionResult Submit(string body) => Ok(body);
}
`, 'request-validation-disabled')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// security/deterministic/token-validation-disabled (wave 3)
// ---------------------------------------------------------------------------

describe('security/deterministic/token-validation-disabled (C#)', () => {
  it('detects ValidateIssuer = false in an initializer', () => {
    const found = matches(`using Microsoft.IdentityModel.Tokens;

namespace App.Auth;

public class TokenSetup
{
    public TokenValidationParameters Build()
        => new TokenValidationParameters { ValidateIssuer = false, ValidateAudience = true };
}
`, 'token-validation-disabled')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('detects ValidateLifetime assigned false', () => {
    const found = matches(`using Microsoft.IdentityModel.Tokens;

namespace App.Auth;

public class TokenSetup
{
    public void Configure(TokenValidationParameters p)
    {
        p.ValidateLifetime = false;
    }
}
`, 'token-validation-disabled')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag all checks left enabled', () => {
    const found = matches(`using Microsoft.IdentityModel.Tokens;

namespace App.Auth;

public class TokenSetup
{
    public TokenValidationParameters Build()
        => new TokenValidationParameters { ValidateIssuer = true, ValidateAudience = true };
}
`, 'token-validation-disabled')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// security/deterministic/unsafe-dllimportsearchpath (wave 3)
// ---------------------------------------------------------------------------

describe('security/deterministic/unsafe-dllimportsearchpath (C#)', () => {
  it('detects an unsafe DllImportSearchPath value', () => {
    const found = matches(`using System.Runtime.InteropServices;

namespace App.Interop;

internal static class Native
{
    [DllImport("plugin.dll")]
    [DefaultDllImportSearchPaths(DllImportSearchPath.LegacyBehavior)]
    internal static extern int Load(int id);
}
`, 'unsafe-dllimportsearchpath')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag System32', () => {
    const found = matches(`using System.Runtime.InteropServices;

namespace App.Interop;

internal static class Native
{
    [DllImport("plugin.dll")]
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    internal static extern int Load(int id);
}
`, 'unsafe-dllimportsearchpath')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// security/deterministic/xmlschema-add-by-url (wave 3)
// ---------------------------------------------------------------------------

describe('security/deterministic/xmlschema-add-by-url (C#)', () => {
  it('detects XmlSchemaSet.Add with a URL', () => {
    const found = matches(`using System.Xml.Schema;

namespace App.Xml;

public class SchemaLoader
{
    public void Register(XmlSchemaSet schemas)
        => schemas.Add("urn:orders", "https://schemas.example.com/orders.xsd");
}
`, 'xmlschema-add-by-url')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag Add with an in-memory reader', () => {
    const found = matches(`using System.Xml;
using System.Xml.Schema;

namespace App.Xml;

public class SchemaLoader
{
    public void Register(XmlSchemaSet schemas, XmlReader reader)
        => schemas.Add("urn:orders", reader);
}
`, 'xmlschema-add-by-url')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// security/deterministic/viewstateuserkey-not-set (wave 4)
// ---------------------------------------------------------------------------

describe('security/deterministic/viewstateuserkey-not-set (C#)', () => {
  it('detects a Page-derived class that never sets ViewStateUserKey', () => {
    const found = matches(`using System;
using System.Web.UI;

namespace App.Web;

public partial class CheckoutPage : Page
{
    protected void Page_Load(object sender, EventArgs e)
    {
        Response.Write("checkout");
    }
}
`, 'viewstateuserkey-not-set')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag a Page that sets ViewStateUserKey in OnInit', () => {
    const found = matches(`using System;
using System.Web.UI;

namespace App.Web;

public partial class CheckoutPage : Page
{
    protected override void OnInit(EventArgs e)
    {
        base.OnInit(e);
        ViewStateUserKey = Session.SessionID;
    }
}
`, 'viewstateuserkey-not-set')
    expect(found).toHaveLength(0)
  })

  it('does not flag a class that does not derive from Page', () => {
    const found = matches(`using System;

namespace App.Web;

public class CheckoutService
{
    public void Run() { }
}
`, 'viewstateuserkey-not-set')
    expect(found).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// security/deterministic/sas-without-https (wave 4)
// ---------------------------------------------------------------------------

describe('security/deterministic/sas-without-https (C#)', () => {
  it('detects a SAS generated with SharedAccessProtocol.HttpsOrHttp', () => {
    const found = matches(`using Microsoft.Azure.Storage;
using Microsoft.Azure.Storage.Blob;

namespace App.Storage;

public class TokenIssuer
{
    public string Issue(CloudBlob blob, SharedAccessBlobPolicy policy)
        => blob.GetSharedAccessSignature(policy, null, null, SharedAccessProtocol.HttpsOrHttp, null);
}
`, 'sas-without-https')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('detects HttpsOrHttp passed as the named protocols argument', () => {
    const found = matches(`using Microsoft.Azure.Storage;
using Microsoft.Azure.Storage.Blob;

namespace App.Storage;

public class TokenIssuer
{
    public string Issue(CloudBlob blob, SharedAccessBlobPolicy policy)
        => blob.GetSharedAccessSignature(policy, protocols: SharedAccessProtocol.HttpsOrHttp);
}
`, 'sas-without-https')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag a SAS pinned to HttpsOnly', () => {
    const found = matches(`using Microsoft.Azure.Storage;
using Microsoft.Azure.Storage.Blob;

namespace App.Storage;

public class TokenIssuer
{
    public string Issue(CloudBlob blob, SharedAccessBlobPolicy policy)
        => blob.GetSharedAccessSignature(policy, null, null, SharedAccessProtocol.HttpsOnly, null);
}
`, 'sas-without-https')
    expect(found).toHaveLength(0)
  })
})
