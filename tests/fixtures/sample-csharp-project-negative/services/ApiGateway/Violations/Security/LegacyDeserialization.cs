using System.IO;
using System.IO.Compression;
using System.Runtime.Serialization.Formatters.Binary;
using System.Text.RegularExpressions;

namespace ApiGateway.Violations.Security;

internal sealed class LegacyDeserialization
{
    internal object Deserialize(Stream stream)
    {
        // VIOLATION: security/deterministic/unsafe-pickle-usage
        var formatter = new BinaryFormatter();
        return formatter.Deserialize(stream);
    }

    internal void ExtractEntry(ZipArchiveEntry entry, string destination)
    {
        // VIOLATION: security/deterministic/unsafe-unzip
        entry.ExtractToFile(Path.Combine(destination, entry.FullName));
    }

    internal Regex BuildValidator()
    {
        // VIOLATION: security/deterministic/redos-vulnerable-regex-python
        return new Regex("(a+)+$");
    }
}
