using System.ComponentModel;

namespace UserServiceApp.Violations.CodeQuality;

/// <summary>
/// Renders the post-sign-in welcome banner. The caption parameter is marked
/// localizable, but the call site hardcodes an English string instead of pulling it
/// from resources.
/// </summary>
internal sealed class WelcomeBanner
{
    private readonly IBannerSink _sink;

    public WelcomeBanner(IBannerSink sink)
    {
        _sink = sink;
    }

    /// <summary>Shows the welcome banner for a signed-in user.</summary>
    public void ShowForUser(string displayName)
    {
        // VIOLATION: code-quality/deterministic/literal-as-localized-parameter
        Render("Welcome back", displayName);
    }

    private void Render([Localizable(true)] string caption, string displayName)
    {
        _sink.Write($"{caption}, {displayName}");
    }
}

internal interface IBannerSink
{
    void Write(string text);
}
