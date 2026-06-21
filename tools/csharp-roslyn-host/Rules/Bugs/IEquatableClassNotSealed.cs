using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// An unsealed, non-abstract class that implements IEquatable&lt;T&gt; where T is the
/// class itself. A subclass cannot extend the strongly-typed Equals(T) without
/// breaking the symmetry contract (a base instance and a derived instance will
/// disagree on equality), so such classes should be sealed. We require T == the
/// declaring type to avoid flagging IEquatable over an unrelated type. Needs the
/// implemented-interface set with its type argument. S4035.
/// </summary>
internal sealed class IEquatableClassNotSealed : ISemanticRule
{
    public string RuleKey => "bugs/deterministic/iequatable-class-not-sealed";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var cls in tree.GetRoot().DescendantNodes().OfType<ClassDeclarationSyntax>())
        {
            if (model.GetDeclaredSymbol(cls) is not INamedTypeSymbol sym) continue;
            if (sym.IsSealed || sym.IsAbstract || sym.IsStatic) continue;

            // IEquatable<This> implemented directly by this type (not merely inherited).
            bool selfEquatable = sym.Interfaces.Any(i =>
                i.OriginalDefinition is { Name: "IEquatable", ContainingNamespace.Name: "System" }
                && i.TypeArguments.Length == 1
                && SymbolEqualityComparer.Default.Equals(i.TypeArguments[0], sym));
            if (!selfEquatable) continue;

            var pos = cls.Identifier.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"Class '{sym.Name}' implements IEquatable<{sym.Name}> but is not sealed — a subclass can break the equality symmetry contract. Seal it.");
        }
    }
}
