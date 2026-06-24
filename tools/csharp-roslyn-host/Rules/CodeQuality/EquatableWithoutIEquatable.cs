using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A type that declares a strongly-typed `public bool Equals(T other)` (T == the
/// declaring type) but does NOT implement `IEquatable<T>`. Generic collections and
/// `EqualityComparer<T>.Default` look up the interface, not the loose method, so the
/// typed equality is bypassed. Needs the interface set and the parameter type.
/// </summary>
internal sealed class EquatableWithoutIEquatable : ISemanticRule
{
    public string RuleKey => "code-quality/deterministic/equatable-without-iequatable";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var typeDecl in tree.GetRoot().DescendantNodes().OfType<TypeDeclarationSyntax>())
        {
            // Records synthesize their own typed Equals + IEquatable<T>; never flag.
            if (typeDecl is RecordDeclarationSyntax) continue;
            if (model.GetDeclaredSymbol(typeDecl) is not INamedTypeSymbol type) continue;
            if (type.TypeKind is not (TypeKind.Class or TypeKind.Struct)) continue;

            var typedEquals = type.GetMembers("Equals").OfType<IMethodSymbol>().FirstOrDefault(
                m => m.DeclaredAccessibility == Accessibility.Public &&
                     !m.IsStatic &&
                     m.MethodKind == MethodKind.Ordinary &&
                     m.ReturnType.SpecialType == SpecialType.System_Boolean &&
                     m.Parameters.Length == 1 &&
                     SymbolEqualityComparer.Default.Equals(m.Parameters[0].Type, type));
            if (typedEquals is null) continue;

            var implementsIEquatable = type.AllInterfaces.Any(
                i => i.Name == "IEquatable" &&
                     i.ContainingNamespace?.ToDisplayString() == "System" &&
                     i.TypeArguments.Length == 1 &&
                     SymbolEqualityComparer.Default.Equals(i.TypeArguments[0], type));
            if (implementsIEquatable) continue;

            var pos = typeDecl.Identifier.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"'{type.Name}' provides a typed Equals({type.Name}) but does not implement IEquatable<{type.Name}>, so generic collections will not use it.");
        }
    }
}
