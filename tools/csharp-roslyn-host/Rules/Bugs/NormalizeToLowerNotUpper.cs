using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A string is normalized with ToLower/ToLowerInvariant. Lowercasing for normalization
/// has a documented round-trip data-loss problem (the Turkish dotless-I), so the
/// guidance is to normalize with ToUpperInvariant instead. CA1308.
///
/// We require the receiver to resolve to System.String so user-defined methods named
/// ToLower on other types are not flagged. Two narrow exemptions:
///   1. ToLower/ToLowerInvariant embedded as an interpolation hole inside a string
///      literal ($"prefix-{s.ToLower()}") is display-only output (CSS class names, HTML
///      attributes) where the case-fold is intentional and ToUpperInvariant would be wrong.
///   2. Lowercasing the result of a non-string `.ToString()` (e.g. bool.ToString() or an
///      enum's ToString()) serializes a value to a lowercase token — `"true"`/`"false"`,
///      a lowercase enum name — where lowercase is the intended output, not text
///      normalization. Upper-casing there would corrupt the token, so it is exempt.
/// </summary>
internal sealed class NormalizeToLowerNotUpper : ISemanticRule
{
    public string RuleKey => "bugs/deterministic/normalize-to-lower-not-upper";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var inv in tree.GetRoot().DescendantNodes().OfType<InvocationExpressionSyntax>())
        {
            if (model.GetSymbolInfo(inv).Symbol is not IMethodSymbol m) continue;
            if (m.ContainingType?.SpecialType != SpecialType.System_String) continue;
            if (m.Name is not ("ToLower" or "ToLowerInvariant")) continue;

            // Exempt: the lowercased value is directly embedded inside a string
            // interpolation hole — a display/markup context (CSS class, HTML attribute)
            // where the lowercase is intentional and ToUpperInvariant would be wrong.
            if (inv.Parent is InterpolationSyntax) continue;

            // Exempt: lowercasing the result of a non-string `.ToString()` serializes a
            // value (bool, enum, …) to a lowercase token where lowercase is the point.
            if (IsLowercasingNonStringToString(model, inv)) continue;

            var pos = TargetLocation(inv).GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"string.{m.Name} for normalization can lose data on round-trip (the Turkish-I problem) — normalize with ToUpperInvariant instead.");
        }
    }

    private static Location TargetLocation(InvocationExpressionSyntax inv) =>
        inv.Expression is MemberAccessExpressionSyntax ma ? ma.Name.GetLocation() : inv.GetLocation();

    /// <summary>
    /// True when the ToLower/ToLowerInvariant receiver is a `.ToString()` call on a
    /// non-string type — `flag.ToString().ToLowerInvariant()` produces `"true"`/`"false"`,
    /// `state.ToString().ToLower()` produces a lowercase enum name: serialization to a
    /// lowercase token, not normalization of user text.
    /// </summary>
    private static bool IsLowercasingNonStringToString(SemanticModel model, InvocationExpressionSyntax inv)
    {
        if (inv.Expression is not MemberAccessExpressionSyntax ma) return false;
        if (ma.Expression is not InvocationExpressionSyntax receiver) return false;
        if (model.GetSymbolInfo(receiver).Symbol is not IMethodSymbol ts) return false;
        if (ts.Name != "ToString" || ts.Parameters.Length != 0) return false;
        // A string's ToString() is identity, so lowercasing it is still normalization.
        return ts.ContainingType?.SpecialType != SpecialType.System_String;
    }
}
