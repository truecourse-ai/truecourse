using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A local variable or parameter whose name hides a field or property of the
/// enclosing type. Shadowing is a classic source of "assigned the wrong thing"
/// bugs: a bare `value = x` can silently target the local instead of the member.
/// Needs symbol resolution to confirm a same-named instance member actually
/// exists on the containing type.
/// </summary>
internal sealed class LocalShadowsField : ISemanticRule
{
    public string RuleKey => "code-quality/deterministic/local-shadows-field";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        var root = tree.GetRoot();

        foreach (var declarator in root.DescendantNodes().OfType<VariableDeclaratorSyntax>())
        {
            // Only locals — field/event declarators have a different parent chain.
            if (declarator.Parent is not VariableDeclarationSyntax { Parent: LocalDeclarationStatementSyntax }) continue;
            if (model.GetDeclaredSymbol(declarator) is not ILocalSymbol local) continue;
            if (Shadows(local.Name, local.ContainingType) is { } memberKind)
            {
                var pos = declarator.Identifier.GetLocation().GetLineSpan().StartLinePosition;
                yield return new Violation(
                    RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                    $"Local '{local.Name}' shadows the {memberKind} '{local.Name}' of '{local.ContainingType?.Name}'; rename it to avoid confusion.");
            }
        }

        foreach (var param in root.DescendantNodes().OfType<ParameterSyntax>())
        {
            if (param.Identifier.IsKind(Microsoft.CodeAnalysis.CSharp.SyntaxKind.None)) continue;
            // Primary-constructor / record positional parameters DEFINE the type's
            // members (the auto-generated properties), so they don't shadow them.
            if (param.Parent is ParameterListSyntax { Parent: TypeDeclarationSyntax }) continue;
            if (model.GetDeclaredSymbol(param) is not IParameterSymbol p) continue;
            // Skip parameters of accessors named `value` (the compiler-supplied setter
            // parameter would otherwise be reported against a same-named member).
            if (p.Name == "value") continue;
            if (Shadows(p.Name, p.ContainingType) is { } memberKind)
            {
                var pos = param.Identifier.GetLocation().GetLineSpan().StartLinePosition;
                yield return new Violation(
                    RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                    $"Parameter '{p.Name}' shadows the {memberKind} '{p.Name}' of '{p.ContainingType?.Name}'; rename it to avoid confusion.");
            }
        }
    }

    /// Returns "field"/"property" if `name` matches an instance field or property
    /// accessible on `type` (including inherited), else null. Static members are not
    /// a shadowing hazard because they require a type-qualified access.
    private static string? Shadows(string name, INamedTypeSymbol? type)
    {
        for (var t = type; t is not null; t = t.BaseType)
        {
            foreach (var m in t.GetMembers(name))
            {
                if (m.IsStatic) continue;
                if (m is IFieldSymbol && !m.IsImplicitlyDeclared) return "field";
                if (m is IPropertySymbol) return "property";
            }
        }
        return null;
    }
}
