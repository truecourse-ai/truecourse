using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A class containing only static members (and no instance state or instance API) but
/// that is neither `static` nor `sealed`, leaving it pointlessly instantiable and
/// subclassable. Needs the full member set to confirm there is nothing instance-level.
/// CA1052.
/// </summary>
internal sealed class StaticHolderTypeNotSealed : ISemanticRule
{
    public string RuleKey => "code-quality/deterministic/static-holder-type-not-sealed";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var classDecl in tree.GetRoot().DescendantNodes().OfType<ClassDeclarationSyntax>())
        {
            if (model.GetDeclaredSymbol(classDecl) is not INamedTypeSymbol type) continue;
            if (type.IsStatic || type.IsSealed || type.IsAbstract) continue;
            // A base class other than object means it participates in a hierarchy; out of scope.
            if (type.BaseType is { SpecialType: not SpecialType.System_Object }) continue;
            if (type.Interfaces.Length > 0) continue;
            // Partial types can have instance members in another part we may not see; skip.
            if (type.DeclaringSyntaxReferences.Length > 1) continue;

            var members = type.GetMembers()
                .Where(m => !m.IsImplicitlyDeclared)
                .ToList();
            // An empty type is a marker, not a static holder.
            if (members.Count == 0) continue;

            var allStatic = members.All(m => m switch
            {
                // The implicit parameterless ctor is filtered above; an EXPLICIT instance
                // constructor means the author intends instantiation.
                IMethodSymbol { MethodKind: MethodKind.Constructor, IsStatic: false } => false,
                IMethodSymbol { MethodKind: MethodKind.StaticConstructor } => true,
                ITypeSymbol => true, // nested types don't count against static-holder status
                _ => m.IsStatic,
            });
            if (!allStatic) continue;

            var pos = classDecl.Identifier.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"'{type.Name}' has only static members but is not static or sealed; mark it static (or sealed) to prevent pointless instantiation and subclassing.");
        }
    }
}
