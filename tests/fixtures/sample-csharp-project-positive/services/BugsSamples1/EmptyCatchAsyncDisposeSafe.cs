using System.IO;
using System.Threading.Tasks;

namespace Positive.Boundary.Bugs;

/// <summary>
/// A single best-effort <c>await x.DisposeAsync()</c> cleanup wrapped in a
/// try/catch. Swallowing the failure of a best-effort async dispose is the same
/// idiom the rule already exempts for the synchronous <c>Dispose()</c> form, so
/// the awaited variant must not be flagged either.
/// </summary>
public sealed class EmptyCatchAsyncDisposeSafe
{
    /// <summary>Disposes the stream, ignoring a failure during the dispose itself.</summary>
    public async Task ReleaseAsync(Stream stream)
    {
        try
        {
            await stream.DisposeAsync();
        }
        // SAFE: bugs/deterministic/empty-catch
        catch (IOException)
        {
        }
    }
}
