namespace Positive.Boundary.CodeQuality.Seeding;

/// <summary>
/// Test seed data. Hardcoded sample URLs in test fixtures are mock values (mock
/// avatars, example profile links), not configurable production endpoints, so
/// the hardcoded-url rule must not flag them.
/// </summary>
public sealed class SeedDataFixture
{
    /// <summary>Builds the set of sample contributor links used by tests.</summary>
    public System.Collections.Generic.List<string> SampleContributorLinks()
    {
        return new System.Collections.Generic.List<string>
        {
            "https://media.contoso-profiles.net/u/1",
            "https://media.contoso-profiles.net/u/1/avatar?v=4",
        };
    }
}
