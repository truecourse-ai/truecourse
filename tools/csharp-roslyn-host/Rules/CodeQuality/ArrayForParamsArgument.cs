using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// An explicit array-creation expression passed as the final argument to a `params`
/// parameter, where the elements could be passed inline. Needs the resolved target
/// method to know the last parameter is `params` and that the argument lands there.
/// S3878.
/// </summary>
internal sealed class ArrayForParamsArgument : ISemanticRule
{
    public string RuleKey => "code-quality/deterministic/array-for-params-argument";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var inv in tree.GetRoot().DescendantNodes().OfType<InvocationExpressionSyntax>())
        {
            var args = inv.ArgumentList.Arguments;
            if (args.Count == 0) continue;

            if (model.GetSymbolInfo(inv).Symbol is not IMethodSymbol m) continue;
            if (m.Parameters.Length == 0) continue;
            var last = m.Parameters[^1];
            if (!last.IsParams) continue;

            // The array must occupy the params slot: there must be exactly one
            // argument beyond the fixed parameters (i.e. argument count == param count)
            // and no named arguments redirecting it.
            if (args.Count != m.Parameters.Length) continue;
            if (args.Any(a => a.NameColon is not null)) continue;

            var lastArg = args[^1].Expression;
            // Only a literal array creation whose element type matches the params
            // element type — `new T[] { ... }` or `new[] { ... }`. A variable holding
            // an array, or a differently-typed array, is legitimately passed as the array.
            var elements = ArrayElements(lastArg);
            if (elements is null) continue;

            // Confirm the array's element type is assignable to the params element type;
            // if the array is the param's own array type passed deliberately, the
            // element types still match, but inlining is the documented preferred form.
            var arrayType = model.GetTypeInfo(lastArg).Type as IArrayTypeSymbol;
            if (arrayType is null) continue;
            if (last.Type is not IArrayTypeSymbol paramArray) continue;
            if (!SymbolEqualityComparer.Default.Equals(arrayType.ElementType, paramArray.ElementType))
                continue;

            var pos = lastArg.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"An explicit array is created for the 'params' parameter '{last.Name}'; pass the elements directly instead.");
        }
    }

    /// Returns the initializer's element list for an explicit array creation, or null.
    private static SeparatedSyntaxList<ExpressionSyntax>? ArrayElements(ExpressionSyntax expr) => expr switch
    {
        ArrayCreationExpressionSyntax { Initializer: { } init } => init.Expressions,
        ImplicitArrayCreationExpressionSyntax { Initializer: { } init } => init.Expressions,
        _ => null,
    };
}
