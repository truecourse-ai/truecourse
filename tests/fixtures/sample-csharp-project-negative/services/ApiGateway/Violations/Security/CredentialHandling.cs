using System.Net;
using Microsoft.Extensions.Logging;

namespace ApiGateway.Violations.Security;

internal sealed class CredentialHandling
{
    // VIOLATION: security/deterministic/hardcoded-secret
    // VIOLATION: security/deterministic/long-term-aws-keys-in-code
    private readonly string _awsSecretKey = "kR8mNp2qT5vWx9zB3cF6hJ1lM4nQ";

    private const string ResetLink = "https://gateway.example.com/reset?access_token=Ab12Cd34Ef56";

    internal NetworkCredential BuildServiceCredential()
    {
        // VIOLATION: security/deterministic/hardcoded-password-function-arg
        return new NetworkCredential("svc-gateway", "Pa55word!Gateway");
    }

    internal string LoadAwsSecret()
    {
        return _awsSecretKey;
    }

    internal string BuildResetLink()
    {
        // VIOLATION: security/deterministic/sensitive-data-in-url
        return ResetLink;
    }

    internal void LogAuthFailure(ILogger logger, string token)
    {
        // VIOLATION: security/deterministic/confidential-info-logging
        logger.LogWarning("Auth failed for token {Token}", token);
    }

    internal bool SignaturesMatch(string providedSignature, string expectedSignature)
    {
        // VIOLATION: security/deterministic/timing-attack-comparison
        return providedSignature == expectedSignature;
    }

    internal void BindPassword(UserRecord user)
    {
        // VIOLATION: code-quality/deterministic/merge-declaration-with-assignment
        string password;
        // VIOLATION: security/deterministic/password-stored-plaintext
        password = Request.Form["password"];
        user.PasswordHash = password;
    }
}
