using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A field declared on a derived type whose name differs from an accessible (non-private)
/// base field ONLY by capitalization (e.g. base `Count` vs derived `count`). The two names
/// read the same to a human, so one easily shadows the other and reads/writes go to the
/// wrong member. Resolving the base-type chain and comparing field names case-insensitively
/// needs the semantic model. S4025/CA1708.
/// </summary>
internal sealed class ChildFieldDiffersOnlyByCase : ISemanticRule
{
    public string RuleKey => "bugs/deterministic/child-field-differs-only-by-case";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var fieldDecl in tree.GetRoot().DescendantNodes().OfType<FieldDeclarationSyntax>())
        {
            foreach (var v in fieldDecl.Declaration.Variables)
            {
                if (model.GetDeclaredSymbol(v) is not IFieldSymbol sym) continue;
                if (sym.ContainingType is not { TypeKind: TypeKind.Class } type) continue;

                for (var b = type.BaseType; b is not null && b.SpecialType != SpecialType.System_Object; b = b.BaseType)
                {
                    var clash = b.GetMembers().OfType<IFieldSymbol>().FirstOrDefault(bf =>
                        !bf.IsImplicitlyDeclared &&
                        bf.DeclaredAccessibility != Accessibility.Private &&
                        !string.Equals(bf.Name, sym.Name, StringComparison.Ordinal) &&
                        string.Equals(bf.Name, sym.Name, StringComparison.OrdinalIgnoreCase));
                    if (clash is null) continue;

                    var pos = v.Identifier.GetLocation().GetLineSpan().StartLinePosition;
                    yield return new Violation(
                        RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                        $"Field '{sym.Name}' differs from inherited '{b.Name}.{clash.Name}' only by case — rename one; the two are easily confused and shadow each other.");
                    break;
                }
            }
        }
    }
}
