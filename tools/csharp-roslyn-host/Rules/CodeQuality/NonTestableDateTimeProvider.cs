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

            // The clock abstraction itself is the sanctioned place to read ambient
            // time — a clock must read DateTime.Now/UtcNow somewhere. Don't flag reads
            // inside a type that IS the injectable clock (named like a clock, or
            // implementing IClock / TimeProvider) — that is exactly what the rule tells
            // callers to inject, so flagging the provider is self-defeating.
            if (IsClockAbstraction(access.FirstAncestorOrSelf<TypeDeclarationSyntax>())) continue;

            var pos = access.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"Direct {owner}.{name} makes time-dependent code untestable; inject a clock abstraction (e.g. TimeProvider) instead.");
        }
    }

    // True when the enclosing type IS a clock abstraction — named like a clock, or
    // implementing/deriving IClock / TimeProvider. Such a type is the single place a
    // codebase reads the ambient clock; the rule recommends injecting it, so flagging
    // it would be self-defeating. Syntax-based so it holds even in loose-text analysis
    // where a project's own IClock interface is unresolved.
    private static bool IsClockAbstraction(TypeDeclarationSyntax? decl)
    {
        if (decl is null) return false;
        if (decl.Identifier.ValueText.EndsWith("Clock", StringComparison.Ordinal)) return true;
        if (decl.BaseList is null) return false;
        foreach (var baseType in decl.BaseList.Types)
        {
            var name = baseType.Type switch
            {
                GenericNameSyntax g => g.Identifier.ValueText,
                IdentifierNameSyntax i => i.Identifier.ValueText,
                QualifiedNameSyntax q => q.Right.Identifier.ValueText,
                _ => null,
            };
            if (name is "IClock" or "TimeProvider" or "ITimeProvider") return true;
        }
        return false;
    }
}
