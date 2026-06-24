using System;

namespace Positive.Boundary.Bugs;

/// <summary>Reads environment configuration using conventional variable names.</summary>
public sealed class LowercaseEnvironmentVariableSafe
{
    /// <summary>The configured proxy, if any.</summary>
    public string Proxy { get; }

    /// <summary>Loads the proxy from the well-known lowercase variable.</summary>
    public LowercaseEnvironmentVariableSafe()
    {
        // SAFE: bugs/deterministic/lowercase-environment-variable
        Proxy = Environment.GetEnvironmentVariable("http_proxy") ?? string.Empty;
    }
}
