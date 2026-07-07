using System;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A framework base that exposes a protected generic configuration helper, mirroring
/// module base classes whose derived types call an inherited <c>Configure&lt;TOptions&gt;</c>
/// with no qualifier.
/// </summary>
public class ConfigurableModuleBase
{
    private int _configuredCount;

    /// <summary>Count of option types registered through this instance.</summary>
    protected int ConfiguredCount => _configuredCount;

    /// <summary>Registers options of the given type — a protected instance helper.</summary>
    protected void Configure<TOptions>(Action<TOptions> setup)
        where TOptions : new()
    {
        var options = new TOptions();
        setup(options);
        _configuredCount++;
    }
}

/// <summary>
/// A module whose private helper calls the inherited protected generic
/// <c>Configure&lt;T&gt;</c> with no qualifier — a use of the receiver. The method is not
/// static-eligible even though it only reads its parameter, so the rule must not fire
/// on an unqualified generic instance-method call.
/// </summary>
public sealed class UnusedThisParameterInheritedConfigureSafe : ConfigurableModuleBase
{
    /// <summary>Delegates configuration to the private helper.</summary>
    public void Initialize(string rootPath)
    {
        ApplyStoragePath(rootPath);
    }

    // Calls the inherited protected Configure<T>(...) with no qualifier — a use of the
    // receiver — so it must not be reported as static-eligible.
    // SAFE: code-quality/deterministic/unused-this-parameter
    private void ApplyStoragePath(string rootPath)
    {
        Configure<StorageOptions>(options => options.RootPath = rootPath);
    }
}

/// <summary>Options bag configured by the module.</summary>
public sealed class StorageOptions
{
    /// <summary>Filesystem root the module serves from.</summary>
    public string? RootPath { get; set; }
}
