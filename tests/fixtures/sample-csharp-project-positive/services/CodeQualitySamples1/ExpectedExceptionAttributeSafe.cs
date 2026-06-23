namespace Positive.Boundary.CodeQuality;

/// <summary>Asserts a throw with the precise <c>Assert.Throws</c> form, not the attribute.</summary>
public sealed class ExpectedExceptionAttributeSafe
{
    // SAFE: code-quality/deterministic/expected-exception-attribute
    internal void RejectsInvalidInput()
    {
        Assert.Throws<InvalidOperationException>(() => Parse("bad"));
    }

    private static int Parse(string raw)
    {
        if (raw != "ok") throw new InvalidOperationException(raw);
        return raw.Length;
    }
}
