using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A class that <i>owns</i> an IDisposable field — i.e. constructs the instance
/// itself via <c>new</c> in the field initializer or a constructor — but does not
/// implement IDisposable, so the held resource is never released.
///
/// To stay false-positive free we require provable ownership: only fields assigned
/// a freshly-constructed object are considered. Borrowed/injected disposables
/// (assigned from a parameter or property) are not owned by this class and are
/// excluded. Static fields and types that already implement IDisposable are
/// likewise skipped.
/// </summary>
internal sealed class ClassWithIDisposableMembersNotDisposable : ISemanticRule
{
    public string RuleKey => "reliability/deterministic/class-with-idisposable-members-not-disposable";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var classDecl in tree.GetRoot().DescendantNodes().OfType<ClassDeclarationSyntax>())
        {
            if (model.GetDeclaredSymbol(classDecl) is not INamedTypeSymbol type) continue;
            if (type.AllInterfaces.Any(i => i.SpecialType == SpecialType.System_IDisposable)) continue;

            var owned = FindOwnedDisposableField(classDecl, model);
            if (owned is null) continue;

            var pos = classDecl.Identifier.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"'{type.Name}' owns IDisposable field '{owned}' (constructed in-class) but does not implement IDisposable — the resource is never released.");
        }
    }

    /// <summary>
    /// Returns the name of the first field of IDisposable type that this class
    /// constructs itself (field-initializer or constructor-body <c>new</c>), or null.
    /// </summary>
    private static string? FindOwnedDisposableField(ClassDeclarationSyntax classDecl, SemanticModel model)
    {
        // Collect candidate IDisposable instance fields, keyed by symbol name.
        var disposableFields = new Dictionary<string, IFieldSymbol>();
        foreach (var fieldDecl in classDecl.Members.OfType<FieldDeclarationSyntax>())
        {
            foreach (var v in fieldDecl.Declaration.Variables)
            {
                if (model.GetDeclaredSymbol(v) is not IFieldSymbol f) continue;
                if (f.IsStatic || f.IsConst) continue;
                if (!ImplementsIDisposable(f.Type)) continue;

                // Owned right here via field initializer `= new ...`?
                if (v.Initializer?.Value is ObjectCreationExpressionSyntax or ImplicitObjectCreationExpressionSyntax)
                    return f.Name;

                disposableFields[f.Name] = f;
            }
        }

        if (disposableFields.Count == 0) return null;

        // Otherwise look for `this.field = new ...` / `field = new ...` in a ctor body.
        foreach (var ctor in classDecl.Members.OfType<ConstructorDeclarationSyntax>())
        {
            foreach (var assign in ctor.DescendantNodes().OfType<AssignmentExpressionSyntax>())
            {
                if (assign.Right is not (ObjectCreationExpressionSyntax or ImplicitObjectCreationExpressionSyntax))
                    continue;
                if (model.GetSymbolInfo(assign.Left).Symbol is IFieldSymbol target &&
                    disposableFields.ContainsKey(target.Name))
                    return target.Name;
            }
        }

        return null;
    }

    private static bool ImplementsIDisposable(ITypeSymbol type) =>
        type.SpecialType == SpecialType.System_IDisposable ||
        type.AllInterfaces.Any(i => i.SpecialType == SpecialType.System_IDisposable);
}
