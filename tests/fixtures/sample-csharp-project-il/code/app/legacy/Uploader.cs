// Legacy file-upload module. ADR-003 moved uploads out of scope; this
// `app/legacy/` package should have been deleted but still ships.
// IL-DRIFT: ForbiddenArtifact:legacy-uploader / forbidden.file-glob.app/legacy/**.present
namespace SampleApi.Legacy;

public static class Uploader
{
    public static void LegacyUpload(string path)
    {
        throw new InvalidOperationException("legacy uploader has been retired");
    }
}
