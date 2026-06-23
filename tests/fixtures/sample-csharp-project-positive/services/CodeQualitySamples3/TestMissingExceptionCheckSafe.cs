using System;
using Xunit;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A test that asserts on a thrown exception: the base-typed
/// <c>Assert.Throws&lt;Exception&gt;</c> result is captured and inspected
/// rather than discarded, so the test-missing-exception-check rule must not
/// fire.
/// </summary>
public class TestMissingExceptionCheckSafe
{
    /// <summary>Verifies the parse failure carries a meaningful message.</summary>
    // SAFE: code-quality/deterministic/test-missing-exception-check
    [Fact]
    public void Parse_RejectsEmptyInput()
    {
        var ex = Assert.Throws<Exception>(() => throw new FormatException("empty input"));
        Assert.Equal("empty input", ex.Message);
    }
}
