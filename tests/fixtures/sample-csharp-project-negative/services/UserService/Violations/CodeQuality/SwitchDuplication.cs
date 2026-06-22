namespace UserServiceApp.Violations.CodeQuality;

internal class SwitchDuplication
{
    private string _lastMode = "none";

    internal string Resolve(string scheme)
    {
        switch (scheme)
        {
            case "ftp":
                return Build("legacy");
            // VIOLATION: code-quality/deterministic/duplicate-switch-section-bodies
            case "ftps":
                return Build("legacy");
            case "https":
                return Build("modern");
            default:
                return Build("unknown");
        }
    }

    internal string LastMode()
    {
        return _lastMode;
    }

    private string Build(string mode)
    {
        _lastMode = mode;
        return mode;
    }
}
