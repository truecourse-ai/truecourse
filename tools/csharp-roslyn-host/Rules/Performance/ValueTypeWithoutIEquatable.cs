using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A `struct` that overrides `object.Equals` (so it has value-equality semantics)
/// but does not implement `IEquatable&lt;T&gt;`. Without the typed interface, equality
/// goes through `object.Equals`, which boxes the argument and — for the default
/// path — uses reflection-based `ValueType.Equals`. The type's resolved members and
/// interface list are what make this precise. CA1066.
///
/// (Scoped to structs that already override Equals to avoid flagging every trivial
/// struct, which would be noisy. Record structs are skipped — the compiler
/// synthesizes IEquatable for them.)
/// </summary>
internal sealed class ValueTypeWithoutIEquatable : ISemanticRule
{
    public string RuleKey => "performance/deterministic/value-type-without-iequatable";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        // `record struct` parses as a RecordDeclarationSyntax, not a
        // StructDeclarationSyntax, so it never appears here; the IsRecord check below
        // is a belt-and-braces guard.
        foreach (var decl in tree.GetRoot().DescendantNodes().OfType<StructDeclarationSyntax>())
        {
            if (model.GetDeclaredSymbol(decl) is not INamedTypeSymbol sym) continue;
            if (sym.TypeKind != TypeKind.Struct) continue;
            if (sym.IsRecord) continue;

            if (!OverridesObjectEquals(sym)) continue;
            if (ImplementsIEquatableOfSelf(sym)) continue;

            var pos = decl.Identifier.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"struct {sym.Name} overrides Equals but does not implement IEquatable<{sym.Name}> — equality boxes and falls back to reflective ValueType.Equals.");
        }
    }

    private static bool OverridesObjectEquals(INamedTypeSymbol sym)
    {
        foreach (var member in sym.GetMembers("Equals"))
            if (member is IMethodSymbol { IsOverride: true, Parameters.Length: 1 } m &&
                m.Parameters[0].Type.SpecialType == SpecialType.System_Object)
                return true;
        return false;
    }

    private static bool ImplementsIEquatableOfSelf(INamedTypeSymbol sym)
    {
        foreach (var iface in sym.AllInterfaces)
        {
            if (iface is not { Name: "IEquatable", ContainingNamespace: { Name: "System", ContainingNamespace.IsGlobalNamespace: true } })
                continue;
            if (iface.TypeArguments.Length == 1 &&
                SymbolEqualityComparer.Default.Equals(iface.TypeArguments[0], sym))
                return true;
        }
        return false;
    }
}
