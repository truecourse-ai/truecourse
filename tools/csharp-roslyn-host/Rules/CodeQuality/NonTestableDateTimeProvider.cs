using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A direct read of `DateTime.Now`, `DateTime.UtcNow`, `DateTime.Today`,
/// `DateTimeOffset.Now`, or `DateTimeOffset.UtcNow` in code. Hard-wiring the ambient
/// clock makes time-dependent logic impossible to unit-test deterministically; an
/// injectable clock abstraction (e.g. TimeProvider / IClock) is preferred. Needs the
/// resolved property symbol to confirm the type and member, not just the syntax.
/// </summary>
internal sealed class NonTestableDateTimeProvider : ISemanticRule
{
    public string RuleKey => "code-quality/deterministic/non-testable-datetime-provider";

    private static readonly HashSet<string> Members = new(StringComparer.Ordinal)
    {
        "Now", "UtcNow", "Today",
    };

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var access in tree.GetRoot().DescendantNodes().OfType<MemberAccessExpressionSyntax>())
        {
            var name = access.Name.Identifier.ValueText;
            if (!Members.Contains(name)) continue;

            if (model.GetSymbolInfo(access).Symbol is not IPropertySymbol prop) continue;
            if (!prop.IsStatic) continue;

            var owner = prop.ContainingType?.SpecialType == SpecialType.System_DateTime
                ? "DateTime"
                : prop.ContainingType?.ToDisplayString() == "System.DateTimeOffset"
                    ? "DateTimeOffset"
                    : null;
            if (owner is null) continue;
            // DateTimeOffset has no `Today`; guard so we only report real members.
            if (owner == "DateTimeOffset" && name == "Today") continue;

            var pos = access.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"Direct {owner}.{name} makes time-dependent code untestable; inject a clock abstraction (e.g. TimeProvider) instead.");
        }
    }
}
