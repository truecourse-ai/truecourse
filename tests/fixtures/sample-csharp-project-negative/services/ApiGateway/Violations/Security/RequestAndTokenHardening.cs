using System;
using System.Diagnostics;
using System.Runtime.ExceptionServices;
using System.Security;
using Microsoft.AspNetCore.Mvc;
using Microsoft.IdentityModel.Tokens;

namespace ApiGateway.Violations.Security;

internal sealed class RequestAndTokenHardening : Controller
{
    // VIOLATION: security/deterministic/request-validation-disabled
    [HttpPost]
    [ValidateInput(false)]
    public IActionResult Submit(string body) => Ok(body);

    internal TokenValidationParameters BuildParameters()
    {
        // VIOLATION: security/deterministic/token-validation-disabled
        return new TokenValidationParameters { ValidateIssuer = false, ValidateAudience = true };
    }

    internal void LaunchTool()
    {
        // VIOLATION: security/deterministic/command-resolved-from-path
        Process.Start("converter.exe");
    }
}

internal sealed class HardeningHelpers
{
    private int _invocations;
    private string? _lastError;

    // VIOLATION: security/deterministic/conflicting-transparency-annotations
    [SecurityCritical]
    [SecuritySafeCritical]
    internal void DoTrustedWork()
    {
        _invocations++;
    }

    // VIOLATION: security/deterministic/catch-corrupted-state-exception
    [HandleProcessCorruptedStateExceptions]
    internal void RunNativeCallback(Action callback)
    {
        try
        {
            callback();
        }
        catch (Exception ex)
        {
            _lastError = ex.Message;
        }
    }

    internal string Status() => _lastError ?? "ok";
}
