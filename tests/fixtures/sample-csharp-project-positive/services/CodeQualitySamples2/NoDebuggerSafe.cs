namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A <c>Break</c> call on an application-level circuit breaker rather than on
/// <c>System.Diagnostics.Debugger</c>, so the no-debugger rule must not fire.
/// </summary>
public class NoDebuggerSafe
{
    private readonly CircuitBreaker breaker = new CircuitBreaker();

    /// <summary>Trips the circuit breaker for the supplied route.</summary>
    public void Trip(string route)
    {
        // SAFE: code-quality/deterministic/no-debugger
        breaker.Break(route);
    }
}

/// <summary>A minimal circuit breaker that records the tripped route.</summary>
public class CircuitBreaker
{
    private string lastRoute = string.Empty;

    /// <summary>Records that the given route tripped the breaker.</summary>
    public void Break(string route)
    {
        lastRoute = route;
    }

    /// <summary>The most recently tripped route.</summary>
    public string LastRoute => lastRoute;
}
