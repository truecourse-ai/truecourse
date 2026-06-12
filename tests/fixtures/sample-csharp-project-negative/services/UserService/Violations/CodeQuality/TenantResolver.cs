namespace UserServiceApp.Violations.CodeQuality;

internal class TenantSnapshot
{
    public string Code { get; set; } = "";
    public string Region { get; set; } = "";
}

internal class TenantResolver
{
    private readonly List<string> _registrations = new List<string>();

    internal string ResolveCacheTarget()
    {
        // VIOLATION: code-quality/deterministic/env-in-library-code
        var cacheHost = Environment.GetEnvironmentVariable("CACHE_HOST") ?? "redis-primary";
        // VIOLATION: code-quality/deterministic/hardcoded-port
        var port = 6379;
        return $"{cacheHost}:{port}";
    }

    internal string ResolveTenantDomain()
    {
        // VIOLATION: code-quality/deterministic/missing-env-validation
        var tenantDomain = Environment.GetEnvironmentVariable("TENANT_DOMAIN").ToLowerInvariant();
        _registrations.Add(tenantDomain);
        return tenantDomain;
    }

    internal string ResolveGatewayRoot()
    {
        // VIOLATION: code-quality/deterministic/hardcoded-url
        return "https://gateway.acme-internal.net/tenants";
    }

    internal int ResolveShard(string tenantId)
    {
        // VIOLATION: code-quality/deterministic/magic-number
        return tenantId.Length % 12;
    }

    internal TenantSnapshot LoadSnapshot(string tenantId)
    {
        // VIOLATION: code-quality/deterministic/boolean-trap
        return BuildSnapshot(tenantId, true, false);
    }

    // VIOLATION: code-quality/deterministic/too-many-positional-arguments
    internal void RegisterTenant(string code, string region, string plan, string owner, int seats, bool sandbox)
    {
        _registrations.Add(code);
        _registrations.Add(region);
        _registrations.Add(plan);
        _registrations.Add(owner);
        _registrations.Add(seats.ToString());
        _registrations.Add(sandbox.ToString());
    }

    internal TenantSnapshot BuildSnapshot(string tenantId, bool includeUsage, bool includeBilling)
    {
        var snapshot = new TenantSnapshot();
        snapshot.Code = tenantId;
        if (includeUsage && includeBilling)
        {
            snapshot.Region = ResolveGatewayRoot();
        }
        return snapshot;
    }
}
