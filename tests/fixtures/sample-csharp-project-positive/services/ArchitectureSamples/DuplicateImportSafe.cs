using System.Text;

namespace Positive.Boundary.Architecture
{
    // SAFE: architecture/deterministic/duplicate-import
    using System.Text;

    /// <summary>Builds a label; the second using sits in a different scope, so it is not a duplicate.</summary>
    public sealed class DuplicateImportSafe
    {
        /// <summary>Joins two parts into one label.</summary>
        internal string Combine(string left, string right)
        {
            StringBuilder builder = new();
            builder.Append(left);
            builder.Append('-');
            builder.Append(right);
            return builder.ToString();
        }
    }
}
