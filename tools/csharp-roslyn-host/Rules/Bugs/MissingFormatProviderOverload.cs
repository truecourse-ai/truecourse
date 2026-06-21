using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A culture-sensitive formatting/parsing call (`<T>.Parse`, `<T>.TryParse`, instance
/// `ToString`, `Convert.ToString`, `string.Format`) is made WITHOUT an IFormatProvider,
/// even though an overload that takes one exists. The result is then locale-dependent.
/// The semantic model is needed to confirm the bound method omits an IFormatProvider
/// parameter while a sibling overload supplies one — guaranteeing a valid fix and no FP
/// on types that have no provider overload. CA1304/CA1305/S4056.
/// </summary>
internal sealed class MissingFormatProviderOverload : ISemanticRule
{
    public string RuleKey => "bugs/deterministic/missing-format-provider-overload";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var inv in tree.GetRoot().DescendantNodes().OfType<InvocationExpressionSyntax>())
        {
            if (model.GetSymbolInfo(inv).Symbol is not IMethodSymbol m) continue;
            if (m.Name is not ("Parse" or "TryParse" or "ToString" or "Format")) continue;

            // Already provider-explicit? skip.
            if (m.Parameters.Any(IsFormatProvider)) continue;

            // ToString() is ubiquitous; only flag it on the numeric / date / formattable
            // BCL types whose parameterless ToString is genuinely culture-sensitive.
            if (m.Name == "ToString" && !IsCultureSensitiveToString(m)) continue;

            // string.Format with a provider overload (CA1305 only meaningfully targets
            // the formattable BCL surface). Restrict Format to System.String.Format.
            if (m.Name == "Format" && m.ContainingType?.SpecialType != SpecialType.System_String) continue;

            var hasOverload = m.ContainingType?.GetMembers(m.Name).OfType<IMethodSymbol>()
                .Any(o => o.Parameters.Any(IsFormatProvider)) == true;
            if (!hasOverload) continue;

            var pos = TargetLocation(inv).GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"{m.ContainingType?.Name}.{m.Name} omits an IFormatProvider — pass CultureInfo.InvariantCulture (or the appropriate culture) for portable, predictable results.");
        }
    }

    private static bool IsFormatProvider(IParameterSymbol p) =>
        p.Type is { Name: "IFormatProvider", ContainingNamespace.Name: "System" } ||
        p.Type is { Name: "CultureInfo" } ||
        p.Type is { Name: "NumberFormatInfo" } ||
        p.Type is { Name: "DateTimeFormatInfo" };

    // ToString without a provider is only culture-sensitive on the numeric/date BCL value
    // types (and decimal). Reference types' ToString is overridable and usually invariant.
    private static bool IsCultureSensitiveToString(IMethodSymbol m) =>
        m.ContainingType?.SpecialType switch
        {
            SpecialType.System_Double or SpecialType.System_Single or SpecialType.System_Decimal or
            SpecialType.System_Int16 or SpecialType.System_Int32 or SpecialType.System_Int64 or
            SpecialType.System_UInt16 or SpecialType.System_UInt32 or SpecialType.System_UInt64 or
            SpecialType.System_Byte or SpecialType.System_SByte => true,
            _ => m.ContainingType?.Name is "DateTime" or "DateTimeOffset" or "TimeSpan",
        };

    private static Location TargetLocation(InvocationExpressionSyntax inv) =>
        inv.Expression is MemberAccessExpressionSyntax ma ? ma.Name.GetLocation() : inv.GetLocation();
}
