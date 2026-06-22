using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// The source file name does not match the name of the first type it declares.
/// When the file holding `class OrderService` is named `Helpers.cs`, the type is hard
/// to locate. We compare the file's base name (sans extension, and sans the generic
/// arity suffix) against the first top-level type. Files that declare no top-level
/// type, or whose first type already matches, are left alone. SA1649.
/// </summary>
internal sealed class FileNameTypeMismatch : ISemanticRule
{
    public string RuleKey => "code-quality/deterministic/csharp-filename-type-mismatch";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        var path = tree.FilePath;
        if (string.IsNullOrEmpty(path)) yield break;

        var fileName = Path.GetFileNameWithoutExtension(path);
        if (string.IsNullOrEmpty(fileName)) yield break;

        // The file is well-named if ANY top-level type matches the file name — a
        // file holding `IOrderRepository` + `OrderRepository` named OrderRepository.cs
        // is correct, so we never flag on the first type alone.
        var identifiers = TopLevelTypeIdentifiers(tree.GetRoot()).ToList();
        if (identifiers.Count == 0) yield break;

        // Allow `OrderService` in `OrderService.cs`, or generic-file conventions
        // (`OrderService{TKey}.cs` / `OrderService.TKey.cs`).
        if (identifiers.Any(id => NameMatches(fileName, id.ValueText))) yield break;

        var first = identifiers[0];
        var pos = first.GetLocation().GetLineSpan().StartLinePosition;
        yield return new Violation(
            RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
            $"File '{fileName}' declares type '{first.ValueText}' but no top-level type matches the file name; name the file after a type so it is easy to locate.");
    }

    private static IEnumerable<SyntaxToken> TopLevelTypeIdentifiers(SyntaxNode root)
    {
        // Identifiers of every top-level type/delegate declaration, in source order.
        foreach (var member in EnumerateTopLevel(root))
            switch (member)
            {
                case BaseTypeDeclarationSyntax t: yield return t.Identifier; break;
                case DelegateDeclarationSyntax d: yield return d.Identifier; break;
            }
    }

    private static IEnumerable<MemberDeclarationSyntax> EnumerateTopLevel(SyntaxNode node)
    {
        var members = node switch
        {
            CompilationUnitSyntax cu => cu.Members,
            BaseNamespaceDeclarationSyntax ns => ns.Members,
            _ => default,
        };
        foreach (var m in members)
        {
            if (m is BaseNamespaceDeclarationSyntax inner)
            {
                foreach (var deep in EnumerateTopLevel(inner)) yield return deep;
            }
            else
            {
                yield return m;
            }
        }
    }

    private static bool NameMatches(string fileName, string typeName)
    {
        if (string.Equals(fileName, typeName, StringComparison.Ordinal)) return true;

        // Strip a generic-parameter file convention: `Cache{TKey,TValue}` or `Cache.TKey`.
        var braceIdx = fileName.IndexOf('{');
        if (braceIdx > 0 && string.Equals(fileName[..braceIdx], typeName, StringComparison.Ordinal))
            return true;

        // `Foo.Bar.cs` (partial-of-Foo convention) — the part before the first dot.
        var dotIdx = fileName.IndexOf('.');
        if (dotIdx > 0 && string.Equals(fileName[..dotIdx], typeName, StringComparison.Ordinal))
            return true;

        return false;
    }
}
