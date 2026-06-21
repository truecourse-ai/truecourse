using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A type implements IComparable / IComparable&lt;T&gt; (defining an ordering) but does not
/// also override Equals and provide the relational operators. Ordering and equality can then
/// disagree (`CompareTo == 0` but `Equals == false`, or `&lt;`/`&gt;` not even compiling),
/// which surprises sorting, dictionaries, and comparisons. Detecting the implemented
/// interface and the presence of Equals / operator overloads needs the semantic model.
/// S1210/CA1036.
/// </summary>
internal sealed class IComparableWithoutEqualityOperators : ISemanticRule
{
    private static readonly string[] RequiredOperators =
        { "op_Equality", "op_Inequality", "op_LessThan", "op_GreaterThan", "op_LessThanOrEqual", "op_GreaterThanOrEqual" };

    public string RuleKey => "bugs/deterministic/icomparable-without-equality-operators";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var typeDecl in tree.GetRoot().DescendantNodes().OfType<TypeDeclarationSyntax>())
        {
            if (typeDecl is not (ClassDeclarationSyntax or StructDeclarationSyntax or RecordDeclarationSyntax)) continue;
            if (model.GetDeclaredSymbol(typeDecl) is not INamedTypeSymbol type) continue;
            if (type.IsAbstract) continue;

            // Records synthesize value equality and operators — never the target of this rule.
            if (type.IsRecord) continue;

            if (!ImplementsIComparable(type)) continue;

            // The interface must be implemented HERE (not just inherited from a base that
            // already does the right thing), so we only fault the type that introduces it.
            if (!type.Interfaces.Any(IsIComparable) &&
                !(type.AllInterfaces.Any(IsIComparable) && type.BaseType?.SpecialType == SpecialType.System_Object))
                continue;

            var members = type.GetMembers();
            bool overridesEquals = members.OfType<IMethodSymbol>().Any(m =>
                m.Name == "Equals" && m.IsOverride && m.Parameters.Length == 1 &&
                m.Parameters[0].Type.SpecialType == SpecialType.System_Object);

            var presentOps = members.OfType<IMethodSymbol>()
                .Where(m => m.MethodKind == MethodKind.UserDefinedOperator)
                .Select(m => m.Name).ToHashSet(StringComparer.Ordinal);
            bool hasAllOperators = RequiredOperators.All(presentOps.Contains);

            if (overridesEquals && hasAllOperators) continue;

            var idLoc = typeDecl.Identifier.GetLocation().GetLineSpan().StartLinePosition;
            var missing = !overridesEquals
                ? "override Equals"
                : $"add the comparison operators ({string.Join(", ", RequiredOperators.Where(o => !presentOps.Contains(o)).Select(OpText))})";
            yield return new Violation(
                RuleKey, tree.FilePath, idLoc.Line + 1, idLoc.Character + 1,
                $"'{type.Name}' implements IComparable but does not {missing} — ordering and equality can disagree.");
        }
    }

    private static bool ImplementsIComparable(INamedTypeSymbol type) => type.AllInterfaces.Any(IsIComparable);

    private static bool IsIComparable(INamedTypeSymbol i) =>
        i.Name == "IComparable" && i.ContainingNamespace is { Name: "System", ContainingNamespace.IsGlobalNamespace: true };

    private static string OpText(string op) => op switch
    {
        "op_Equality" => "==", "op_Inequality" => "!=",
        "op_LessThan" => "<", "op_GreaterThan" => ">",
        "op_LessThanOrEqual" => "<=", "op_GreaterThanOrEqual" => ">=",
        _ => op,
    };
}
