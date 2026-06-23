using System.Runtime.CompilerServices;

namespace Positive.Boundary.Bugs;

/// <summary>Records trace messages with the calling member supplied last.</summary>
public sealed class CallerInfoParamNotLastSafe
{
    private int _calls;

    /// <summary>Traces a message, letting the compiler fill the trailing caller name.</summary>
    // SAFE: bugs/deterministic/caller-info-param-not-last
    internal void Trace(string message, [CallerMemberName] string member = "")
    {
        _calls += message.Length + member.Length;
    }

    /// <summary>Number of trace calls recorded.</summary>
    internal int Calls => _calls;
}
