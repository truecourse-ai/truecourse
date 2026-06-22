using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// Two overloads of the same method overlap once optional parameters are filled in: one
/// overload's required parameters are a prefix of another's, and the longer overload's extra
/// trailing parameters are ALL optional. A call supplying just the shared prefix is then
/// callable against both signatures, and C# silently binds to the one WITHOUT the optional
/// parameters — so the defaulted overload is unreachable for that arity, surprising the reader.
/// Comparing parameter types and optionality across the overload set needs the semantic model.
/// </summary>
internal sealed class OverlappingDefaultOverloads : ISemanticRule
{
    public string RuleKey => "bugs/deterministic/overlapping-default-overloads";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var typeDecl in tree.GetRoot().DescendantNodes().OfType<TypeDeclarationSyntax>())
        {
            if (model.GetDeclaredSymbol(typeDecl) is not INamedTypeSymbol type) continue;

            var byName = type.GetMembers().OfType<IMethodSymbol>()
                .Where(m => m.MethodKind == MethodKind.Ordinary && !m.IsOverride)
                .GroupBy(m => m.Name, StringComparer.Ordinal);

            foreach (var group in byName)
            {
                var overloads = group.ToList();
                if (overloads.Count < 2) continue;

                foreach (var shorter in overloads)
                    foreach (var longer in overloads)
                    {
                        if (ReferenceEquals(shorter, longer)) continue;
                        if (longer.Parameters.Length <= shorter.Parameters.Length) continue;
                        if (!IsAmbiguousOverlap(shorter, longer)) continue;

                        var loc = longer.Locations.FirstOrDefault(l => l.SourceTree == tree);
                        if (loc is null) continue;
                        var pos = loc.GetLineSpan().StartLinePosition;
                        yield return new Violation(
                            RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                            $"Overload '{longer.Name}' with {longer.Parameters.Length - shorter.Parameters.Length} optional trailing parameter(s) overlaps the {shorter.Parameters.Length}-parameter overload — a call with {shorter.Parameters.Length} argument(s) silently binds to the other, making this overload's defaults unreachable.");
                    }
            }
        }
    }

    // shorter's required parameters are a type-prefix of longer's, and every parameter of
    // longer beyond shorter's length is optional — so a shorter-arity call hits both.
    private static bool IsAmbiguousOverlap(IMethodSymbol shorter, IMethodSymbol longer)
    {
        // The shorter overload must itself be callable with exactly its own count of
        // required args (no params spread shenanigans).
        if (shorter.Parameters.Any(p => p.IsParams) || longer.Parameters.Any(p => p.IsParams)) return false;

        for (var i = 0; i < shorter.Parameters.Length; i++)
        {
            if (shorter.Parameters[i].RefKind != longer.Parameters[i].RefKind) return false;
            if (!SymbolEqualityComparer.Default.Equals(shorter.Parameters[i].Type, longer.Parameters[i].Type))
                return false;
        }
        // shorter must have no optional tail that itself disambiguates by name; require all
        // shorter params non-optional so the shared call site is unambiguous in arity.
        if (shorter.Parameters.Any(p => p.IsOptional)) return false;

        for (var i = shorter.Parameters.Length; i < longer.Parameters.Length; i++)
            if (!longer.Parameters[i].IsOptional) return false;

        return true;
    }
}
