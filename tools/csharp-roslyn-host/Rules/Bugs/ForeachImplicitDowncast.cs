using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A `foreach` whose declared loop-variable type forces an implicit DOWNCAST of each element
/// (the collection's element type is a base of the declared type, with no `var`). The cast is
/// inserted silently by the language and throws InvalidCastException at runtime if any element
/// is not actually of the narrower type. We compare the collection's element type to the
/// declared loop type via the semantic model and only flag a genuine downcast (declared type
/// derives from the element type), excluding `var`, identical types, and upcasts.
/// </summary>
internal sealed class ForeachImplicitDowncast : ISemanticRule
{
    public string RuleKey => "bugs/deterministic/foreach-implicit-downcast";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var fe in tree.GetRoot().DescendantNodes().OfType<ForEachStatementSyntax>())
        {
            // `foreach (var x in ...)` infers the element type — never a downcast.
            if (fe.Type is IdentifierNameSyntax { IsVar: true }) continue;

            var info = Microsoft.CodeAnalysis.CSharp.CSharpExtensions.GetForEachStatementInfo(model, fe);
            var elementType = info.ElementType;
            if (elementType is null || elementType.TypeKind == TypeKind.Error) continue;

            var declared = model.GetTypeInfo(fe.Type).Type;
            if (declared is null || declared.TypeKind == TypeKind.Error) continue;
            if (SymbolEqualityComparer.Default.Equals(declared, elementType)) continue;

            // Only reference-type class/interface narrowing is the runtime-throwing downcast.
            if (elementType.IsValueType || declared.IsValueType) continue;
            // object element with object declared was equal; element 'object' downcast to a
            // specific type is the canonical case.
            if (!InheritsOrImplements(declared, elementType)) continue;

            var pos = fe.Type.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"foreach declares each '{elementType.ToDisplayString()}' element as '{declared.ToDisplayString()}', forcing a silent downcast that throws InvalidCastException if an element is not that type.");
        }
    }

    // declared is a strict subtype of (or implements) elementType — i.e. going from element
    // type to declared type is a narrowing/downcast.
    private static bool InheritsOrImplements(ITypeSymbol declared, ITypeSymbol elementType)
    {
        for (var b = declared.BaseType; b is not null; b = b.BaseType)
            if (SymbolEqualityComparer.Default.Equals(b, elementType)) return true;
        if (elementType.TypeKind == TypeKind.Interface)
            return declared.AllInterfaces.Any(i => SymbolEqualityComparer.Default.Equals(i, elementType));
        return false;
    }
}
