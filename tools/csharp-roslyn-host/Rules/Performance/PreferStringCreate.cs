using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A <c>FormattableString.Invariant(...)</c> call over an interpolated string (S6618).
/// The helper boxes the interpolation into a <c>FormattableString</c> and then formats
/// it; <c>string.Create(CultureInfo.InvariantCulture, $"…")</c> formats the same
/// interpolation directly through an interpolated-string handler with no
/// <c>FormattableString</c> allocation. Resolved by symbol so only the real
/// <c>System.FormattableString.Invariant</c> helper is flagged, and only when the
/// argument is an interpolated string — the allocating path.
/// </summary>
internal sealed class PreferStringCreate : ISemanticRule
{
    public string RuleKey => "performance/deterministic/prefer-string-create";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var inv in tree.GetRoot().DescendantNodes().OfType<InvocationExpressionSyntax>())
        {
            if (inv.Expression is not MemberAccessExpressionSyntax ma) continue;
            if (ma.Name.Identifier.ValueText != "Invariant") continue;
            if (inv.ArgumentList.Arguments.Count != 1) continue;
            if (inv.ArgumentList.Arguments[0].Expression is not InterpolatedStringExpressionSyntax) continue;

            if (model.GetSymbolInfo(inv).Symbol is not IMethodSymbol m) continue;
            if (m.ContainingType?.ToDisplayString() != "System.FormattableString") continue;

            var pos = inv.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                "FormattableString.Invariant allocates a FormattableString to format this interpolation; string.Create(CultureInfo.InvariantCulture, $\"…\") formats it directly with no allocation.");
        }
    }
}
