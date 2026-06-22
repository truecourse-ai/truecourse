using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A file's namespace should mirror its location under the project root, so types
/// are where their namespace says they are. This is a project-aware rule: it needs
/// the file's on-disk path relative to the project directory, which only exists
/// once the real .csproj is loaded (MSBuildWorkspace), not from loose file texts.
///
/// Precision over the strict root-anchored variant: we require the namespace to
/// END WITH the folder segments (in order) rather than equal RootNamespace + path.
/// That flags the real defect — a type sitting in a folder its namespace ignores —
/// without assuming a particular base namespace, so a deliberate company root
/// (e.g. Acme.*) never produces a false positive. (IDE0130-style convention.)
/// </summary>
internal sealed class NamespaceFolderMismatch : IProjectAwareRule
{
    public string RuleKey => "architecture/deterministic/namespace-folder-mismatch";

    public IEnumerable<Violation> Analyze(ProjectContext ctx, SemanticModel model, SyntaxTree tree)
    {
        if (string.IsNullOrEmpty(ctx.ProjectDirectory) || string.IsNullOrEmpty(tree.FilePath))
            yield break;

        // Only the unambiguous single-namespace case. Files with several namespaces,
        // or top-level types in the global namespace, are out of this rule's scope
        // (the latter is a separate rule).
        var root = tree.GetRoot();
        var namespaces = root.DescendantNodes().OfType<BaseNamespaceDeclarationSyntax>().ToList();
        if (namespaces.Count != 1) yield break;
        var ns = namespaces[0];
        if (ns.Parent is not CompilationUnitSyntax) yield break; // nested decls are intentional

        var folders = FolderSegments(ctx.ProjectDirectory, tree.FilePath);
        if (folders is null || folders.Length == 0) yield break; // root file or convention undefined

        var actual = ns.Name.ToString();
        if (NamespaceEndsWith(actual, folders)) yield break;

        var pos = ns.Name.GetLocation().GetLineSpan().StartLinePosition;
        yield return new Violation(
            RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
            $"Namespace '{actual}' does not match the file's folder path; it should end with '{string.Join(".", folders)}'.");
    }

    // The relative folder path from the project directory, split into identifier
    // segments. null when the file is outside the project tree or a folder name
    // can't be a namespace part (so the convention simply doesn't apply).
    private static string[]? FolderSegments(string projectDir, string filePath)
    {
        var dir = Path.GetDirectoryName(filePath) ?? string.Empty;
        var rel = Path.GetRelativePath(projectDir, dir);
        if (rel == "." || rel.Length == 0) return Array.Empty<string>();
        if (rel.StartsWith("..")) return null;

        var segments = new List<string>();
        foreach (var seg in rel.Split(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar))
        {
            if (seg.Length == 0) continue;
            if (!SyntaxFacts.IsValidIdentifier(seg)) return null;
            segments.Add(seg);
        }
        return segments.ToArray();
    }

    private static bool NamespaceEndsWith(string ns, string[] folders)
    {
        var parts = ns.Split('.');
        if (folders.Length > parts.Length) return false;
        var offset = parts.Length - folders.Length;
        for (var i = 0; i < folders.Length; i++)
            if (!string.Equals(parts[offset + i], folders[i], StringComparison.Ordinal)) return false;
        return true;
    }
}
