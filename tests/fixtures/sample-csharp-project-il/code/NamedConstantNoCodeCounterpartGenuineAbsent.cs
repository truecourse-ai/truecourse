// Storage writer configuration.
//
// The spec pins storage.writer.batch_depth_limit = 500 as a named constant, but
// the code has no corresponding declaration — the limit is hard-wired inline and
// never named.
//
// IL-DRIFT: NamedConstant:storage.writer.batch_depth_limit / constant.storage.writer.batch_depth_limit.no-code-counterpart
namespace SampleApi;

public static class StorageWriter
{
    public static void Flush(int depth)
    {
        // Batch depth limit hard-wired inline instead of a named constant.
        if (depth > 500)
        {
            throw new InvalidOperationException("batch too deep");
        }
    }
}
