using System.IO;
using System.Text;

namespace Positive.Boundary.Bugs;

/// <summary>Reads a stream line by line using the classic assign-and-compare idiom.</summary>
public sealed class AssignmentInConditionSafe
{
    /// <summary>Concatenates every line of the reader into a single string.</summary>
    internal string ReadAll(TextReader reader)
    {
        var builder = new StringBuilder();
        string? line;
        // SAFE: bugs/deterministic/assignment-in-condition
        while ((line = reader.ReadLine()) != null)
        {
            builder.Append(line);
        }
        return builder.ToString();
    }
}
