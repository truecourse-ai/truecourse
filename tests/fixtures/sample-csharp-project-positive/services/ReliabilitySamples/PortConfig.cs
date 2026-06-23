namespace Positive.Boundary.Reliability;

/// <summary>
/// Reads a port from the environment and coalesces a default before parsing,
/// so the parse can never receive null. Config-named, so the env read itself
/// is the sanctioned bootstrap surface.
/// </summary>
public class PortConfig
{
    /// <summary>Returns the configured port, defaulting when the variable is unset.</summary>
    public int Port()
    {
        // SAFE: reliability/deterministic/invalid-envvar-default
        return int.Parse(
            System.Environment.GetEnvironmentVariable("APP_PORT") ?? "8080",
            System.Globalization.CultureInfo.InvariantCulture);
    }
}
