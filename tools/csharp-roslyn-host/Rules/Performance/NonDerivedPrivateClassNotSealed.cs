using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A non-abstract, non-static, non-sealed class with assembly-private visibility —
/// a `private` nested class or a `file`-scoped class — that is never used as a base
/// type anywhere in the compilation. Because its visibility forbids inheritance from
/// outside this assembly, the absence of any subclass here proves nothing derives
/// from it, so it can be `sealed` (a small devirtualization win and clearer intent).
/// Scoped to private/file visibility so the single-compilation view is complete — an
/// internal/public class could be subclassed in code we cannot see. CA1852.
/// </summary>
internal sealed class NonDerivedPrivateClassNotSealed : ISemanticRule
{
    public string RuleKey => "performance/deterministic/non-derived-private-class-not-sealed";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        var compilation = model.Compilation;

        // A `record class` parses as RecordDeclarationSyntax (not
        // ClassDeclarationSyntax), so it never reaches this loop.
        foreach (var decl in tree.GetRoot().DescendantNodes().OfType<ClassDeclarationSyntax>())
        {
            if (HasModifier(decl, "sealed") || HasModifier(decl, "abstract") || HasModifier(decl, "static"))
                continue;

            // Visibility must forbid cross-assembly inheritance for the no-subclass
            // observation to be conclusive: `private` (nested) or `file`-scoped.
            var isPrivate = HasModifier(decl, "private");
            var isFile = HasModifier(decl, "file");
            if (!isPrivate && !isFile) continue;

            if (model.GetDeclaredSymbol(decl) is not INamedTypeSymbol sym) continue;
            if (sym.IsStatic || sym.IsSealed || sym.IsAbstract || sym.IsRecord) continue;

            if (HasSubclassInCompilation(compilation, sym)) continue;

            var pos = decl.Identifier.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"Class {sym.Name} is private/file-scoped, never subclassed, and not sealed — seal it to clarify intent and enable devirtualization.");
        }
    }

    private static bool HasModifier(ClassDeclarationSyntax decl, string text) =>
        decl.Modifiers.Any(t => t.ValueText == text);

    private static bool HasSubclassInCompilation(Compilation compilation, INamedTypeSymbol target)
    {
        foreach (var tree in compilation.SyntaxTrees)
        {
            var model = compilation.GetSemanticModel(tree);
            foreach (var other in tree.GetRoot().DescendantNodes().OfType<TypeDeclarationSyntax>())
            {
                if (model.GetDeclaredSymbol(other) is not INamedTypeSymbol s) continue;
                if (SymbolEqualityComparer.Default.Equals(s, target)) continue;
                if (s.BaseType is { } bt && SymbolEqualityComparer.Default.Equals(bt, target))
                    return true;
            }
        }
        return false;
    }
}
