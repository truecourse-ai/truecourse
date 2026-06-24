using System.Runtime.InteropServices;

namespace Positive.Boundary.Bugs;

/// <summary>Tunes retry behaviour using a correctly defaulted optional parameter.</summary>
public sealed class DefaultValueInsteadOfDefaultParameterValueSafe
{
    private int _maxRetries = 1;

    /// <summary>Sets the retry count, defaulting via the runtime-honoured mechanism.</summary>
    // SAFE: bugs/deterministic/defaultvalue-instead-of-defaultparametervalue
    internal void Tune([Optional, DefaultParameterValue(3)] int retries)
    {
        _maxRetries = retries;
    }

    /// <summary>The currently configured retry count.</summary>
    internal int MaxRetries => _maxRetries;
}
