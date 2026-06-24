using System;
using Xunit;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A test that seeds its random generator (<c>new Random(seed)</c>) so results are
/// reproducible. The rule flags only seedless <c>new Random()</c>, so a seeded
/// generator correctly stays clean.
/// </summary>
public sealed class FlakyTestSafe
{
    private const int Seed = 1234;
    private const int Bound = 10;

    /// <summary>A seeded generator yields a value within the requested bound.</summary>
    [Fact]
    public void SeededRandom_StaysWithinBound()
    {
        // SAFE: code-quality/deterministic/flaky-test
        var random = new Random(Seed);

        var value = random.Next(0, Bound);

        Assert.InRange(value, 0, Bound);
    }
}
