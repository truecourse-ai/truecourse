using System.IO;

namespace Positive.Boundary.Reliability;

internal sealed class ReturnDisposableFromUsingSafe
{
    internal string ReadAll(string path)
    {
        using (var reader = new StreamReader(path))
        {
            // SAFE: reliability/deterministic/return-disposable-from-using
            return reader.ReadToEnd();
        }
    }
}
