using System.Runtime.InteropServices;

namespace Positive.Boundary.Bugs;

/// <summary>Pairs [DefaultParameterValue] with [Optional] so the default is actually applied.</summary>
public sealed class DefaultparametervalueWithoutOptionalSafe
{
    private int _activePort;

    /// <summary>Configures the active port, defaulting to the standard value when omitted.</summary>
    // SAFE: bugs/deterministic/defaultparametervalue-without-optional
    internal void Configure([Optional, DefaultParameterValue(8080)] int port)
    {
        _activePort = port;
    }

    /// <summary>The currently configured port.</summary>
    internal int ActivePort => _activePort;
}
