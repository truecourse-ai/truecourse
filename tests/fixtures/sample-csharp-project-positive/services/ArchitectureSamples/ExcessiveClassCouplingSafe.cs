using System;
using System.Text;

namespace Positive.Boundary.Architecture;

/// <summary>Assembles a short report; one method touches a handful of types, well under the limit.</summary>
public sealed class ExcessiveClassCouplingSafe
{
    /// <summary>Formats a labelled window built from a few collaborator types.</summary>
    // SAFE: architecture/deterministic/excessive-class-coupling
    internal string Describe(TimeSpan window, string label, Guid id)
    {
        var span = new TimeSpan(window.Ticks);
        var text = new StringBuilder();
        text.Append(label);
        text.Append(':');
        text.Append(span.TotalSeconds);
        text.Append(':');
        text.Append(id);
        return text.ToString();
    }
}
