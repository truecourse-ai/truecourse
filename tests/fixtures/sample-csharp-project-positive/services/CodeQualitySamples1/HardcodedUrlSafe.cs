namespace Positive.Boundary.CodeQuality;

/// <summary>
/// Holds the GitHub REST base address. It is an <c>https://</c> URL — right at the
/// rule's trigger — but points at a stable third-party API host (<c>api.github.com</c>)
/// that has no environment-specific form, which the rule explicitly excludes.
/// </summary>
public sealed class HardcodedUrlSafe
{
    /// <summary>The stable, vendor-owned GitHub API root.</summary>
    // SAFE: code-quality/deterministic/hardcoded-url
    internal const string GitHubApiRoot = "https://api.github.com";

    /// <summary>The repository these endpoints are scoped to.</summary>
    private readonly string _repo;

    /// <summary>Creates a builder scoped to a repository.</summary>
    internal HardcodedUrlSafe(string repo)
    {
        _repo = repo;
    }

    /// <summary>Builds the issues endpoint for this repository.</summary>
    internal string IssuesEndpoint()
    {
        return $"{GitHubApiRoot}/repos/{_repo}/issues";
    }
}
