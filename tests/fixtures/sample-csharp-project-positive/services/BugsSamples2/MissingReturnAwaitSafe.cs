using System.Threading.Tasks;

namespace Positive.Boundary.Bugs;

/// <summary>Awaits the task inside the using scope before returning.</summary>
internal sealed class MissingReturnAwaitSafe
{
    /// <summary>Fetches a manifest for the region with the connection held open until completion.</summary>
    internal async Task<string> FetchManifestAsync(string region)
    {
        using (var conn = new Connection())
        {
            // SAFE: bugs/deterministic/missing-return-await
            return await conn.LoadAsync(region);
        }
    }

    private sealed class Connection : System.IDisposable
    {
        internal Task<string> LoadAsync(string region) => Task.FromResult(region);

        /// <summary>Releases the connection.</summary>
        void System.IDisposable.Dispose()
        {
            // No unmanaged resources to release.
        }
    }
}
