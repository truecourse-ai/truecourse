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

        // The first type declared in the file (ignoring nested types) is the one the
        // file should be named for.
        var identifier = FirstTopLevelTypeIdentifier(tree.GetRoot());
        if (identifier is not { } id) yield break;

        var typeName = id.ValueText;

        // Allow `OrderService` to live in either `OrderService.cs` or, for generics,
        // `OrderService{TKey}.cs` / `OrderService.TKey.cs` — compare against the bare
        // type name and a few common generic-file conventions.
        if (NameMatches(fileName, typeName)) yield break;

        var pos = id.GetLocation().GetLineSpan().StartLinePosition;
        yield return new Violation(
            RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
            $"File '{fileName}' declares type '{typeName}' first; name the file after the type so it is easy to locate.");
    }

    private static SyntaxToken? FirstTopLevelTypeIdentifier(SyntaxNode root)
    {
        // Walk compilation-unit and namespace members in order; return the identifier
        // of the first type/delegate declaration encountered.
        foreach (var member in EnumerateTopLevel(root))
            switch (member)
            {
                case BaseTypeDeclarationSyntax t: return t.Identifier;
                case DelegateDeclarationSyntax d: return d.Identifier;
            }
        return null;
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
