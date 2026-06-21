using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A type derived from System.Buffers.MemoryManager&lt;T&gt; that declares a finalizer.
/// The finalizer can run while a Span obtained from the manager is still alive, freeing
/// memory that live spans reference and causing use-after-free. Needs base-type
/// resolution to confirm the MemoryManager&lt;T&gt; ancestry. CA2015.
/// </summary>
internal sealed class FinalizerOnMemoryManager : ISemanticRule
{
    public string RuleKey => "bugs/deterministic/finalizer-on-memorymanager";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var dtor in tree.GetRoot().DescendantNodes().OfType<DestructorDeclarationSyntax>())
        {
            if (model.GetDeclaredSymbol(dtor) is not IMethodSymbol m) continue;
            var type = m.ContainingType;
            if (type is null || !DerivesFromMemoryManager(type)) continue;

            var pos = dtor.Identifier.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"'{type.Name}' derives from MemoryManager<T> and declares a finalizer — it can free memory while a live Span still references it. Remove the finalizer.");
        }
    }

    private static bool DerivesFromMemoryManager(INamedTypeSymbol type)
    {
        for (var t = type.BaseType; t is not null; t = t.BaseType)
            if (t.OriginalDefinition is { Name: "MemoryManager" } o &&
                o.ContainingNamespace.ToDisplayString() == "System.Buffers")
                return true;
        return false;
    }
}
