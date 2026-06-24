using System.Runtime.CompilerServices;

namespace Positive.Boundary.Bugs;

/// <summary>Records trace messages and lets the compiler supply the caller name.</summary>
public sealed class ExplicitCallerInfoArgumentSafe
{
    private string _last = string.Empty;

    private void Record(string message, [CallerMemberName] string member = "")
    {
        _last = $"{member}: {message}";
    }

    /// <summary>Records a message, omitting the caller-info argument so the compiler fills it.</summary>
    internal string Run()
    {
        // SAFE: bugs/deterministic/explicit-caller-info-argument
        Record("starting");
        return _last;
    }
}
