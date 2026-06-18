namespace ApiGateway.Violations.Bugs;

internal class EnvironmentSettingsLoader
{
    // VIOLATION: bugs/deterministic/invalid-character-in-source
    private const string LegacyCacheAlias = "cache​entry";

    internal string ResolveDatabaseUrl()
    {
        // VIOLATION: bugs/deterministic/lowercase-environment-variable
        var raw = Environment.GetEnvironmentVariable("database_url");
        return raw ?? string.Empty;
    }

    internal bool IsLegacyCacheName(string name)
    {
        return name == LegacyCacheAlias;
    }
}
