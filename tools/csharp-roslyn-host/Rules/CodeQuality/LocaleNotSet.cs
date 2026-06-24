using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A culture-sensitive type — `System.Data.DataTable` or `System.Data.DataSet` —
/// constructed without its `Locale` being set in the same initializer, so its
/// sorting/filtering behavior follows the ambient culture and varies by environment.
/// We resolve the constructed type and, for object-initializer creations, check
/// whether `Locale` is assigned; a bare `new DataTable()` with no initializer is the
/// clear offender.
/// </summary>
internal sealed class LocaleNotSet : ISemanticRule
{
    public string RuleKey => "code-quality/deterministic/locale-not-set";

    private static readonly HashSet<string> CultureSensitive = new(StringComparer.Ordinal)
    {
        "System.Data.DataTable",
        "System.Data.DataSet",
    };

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var creation in tree.GetRoot().DescendantNodes().OfType<ObjectCreationExpressionSyntax>())
        {
            if (model.GetTypeInfo(creation).Type is not INamedTypeSymbol type) continue;
            if (!CultureSensitive.Contains(type.ToDisplayString())) continue;

            // An object initializer that sets Locale is explicit and fine.
            if (creation.Initializer is { } init && SetsLocale(init)) continue;

            var pos = creation.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"'{type.Name}' is created without setting Locale; its culture-sensitive behavior will vary by environment — set Locale explicitly.");
        }
    }

    private static bool SetsLocale(InitializerExpressionSyntax init)
    {
        foreach (var expr in init.Expressions)
            if (expr is AssignmentExpressionSyntax { Left: IdentifierNameSyntax { Identifier.ValueText: "Locale" } })
                return true;
        return false;
    }
}
