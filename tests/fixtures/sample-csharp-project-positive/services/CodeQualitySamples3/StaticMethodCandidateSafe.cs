namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A private helper that reads an instance field, so it genuinely depends on
/// instance state and cannot be made static. The rule must not fire.
/// </summary>
public class StaticMethodCandidateSafe
{
    private readonly string _environment;

    internal StaticMethodCandidateSafe(string environment)
    {
        _environment = environment;
    }

    internal bool Matches(string flag) => Qualify(flag).Length > 0;

    // SAFE: code-quality/deterministic/static-method-candidate
    private string Qualify(string flag) => $"{_environment}:{flag}";
}
