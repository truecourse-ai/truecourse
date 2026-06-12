// Spec forbids any debug env-var in production builds. PROD_DEBUG gates verbose
// request logging and must not be read.
// IL-DRIFT: ForbiddenArtifact:prod-debug-env / forbidden.env-var.PROD_DEBUG.present
namespace SampleApi.Services;

public static class Debug
{
    private static readonly bool DebugMode =
        Environment.GetEnvironmentVariable("PROD_DEBUG") == "true";

    public static void DebugLog(params object[] args)
    {
        if (DebugMode)
        {
            Console.WriteLine("[debug] " + string.Join(" ", args));
        }
    }
}
