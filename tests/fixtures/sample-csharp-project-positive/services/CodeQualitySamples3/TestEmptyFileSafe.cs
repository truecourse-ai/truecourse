using NUnit.Framework;

namespace Positive.Boundary.CodeQuality;

/// <summary>NUnit fixture that carries at least one real test method.</summary>
// SAFE: code-quality/deterministic/test-empty-file
[TestFixture]
public sealed class TestEmptyFileSafe
{
    [Test]
    public void Sum_AddsTwoOperands()
    {
        Assert.AreEqual(3, 1 + 2);
    }
}
