// Spec forbids FEATURE_EXPORT_V2 from any shipped config — the data-export
// feature is GA, so the flag must be removed. It still ships in
// config/features.json.
// IL-DRIFT: ForbiddenArtifact:feature-experimental-export / forbidden.feature-flag.FEATURE_EXPORT_V2.present
using System.Text.Json;

namespace SampleApi.Services;

public static class Features
{
    public static Dictionary<string, bool> LoadFlags()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "config", "features.json");
        var json = File.ReadAllText(path);
        return JsonSerializer.Deserialize<Dictionary<string, bool>>(json) ?? new();
    }
}
