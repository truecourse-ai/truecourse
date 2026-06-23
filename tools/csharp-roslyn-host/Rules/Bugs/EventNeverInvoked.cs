using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// An event declared on a type that is never raised anywhere inside it. Because C#
/// only lets the declaring type raise an event, an event with zero in-type
/// references can never fire — every subscriber is silently dead. Kept
/// false-positive free by the strict signal: the event symbol must appear NOWHERE in
/// the type's bodies (any reference at all — a raise, a `+=`, capturing it to a
/// local — clears it). Virtual/abstract/override and interface events are excluded,
/// since a different part of the hierarchy may raise those.
/// </summary>
internal sealed class EventNeverInvoked : ISemanticRule
{
    public string RuleKey => "bugs/deterministic/event-never-invoked";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var typeDecl in tree.GetRoot().DescendantNodes().OfType<TypeDeclarationSyntax>())
        {
            var candidates = new List<(IEventSymbol Sym, Location Loc)>();
            foreach (var member in typeDecl.Members)
            {
                if (member is EventFieldDeclarationSyntax ef)
                {
                    foreach (var v in ef.Declaration.Variables)
                        if (model.GetDeclaredSymbol(v) is IEventSymbol es && IsCandidate(es))
                            candidates.Add((es, v.Identifier.GetLocation()));
                }
                else if (member is EventDeclarationSyntax ed
                         && model.GetDeclaredSymbol(ed) is IEventSymbol es2 && IsCandidate(es2))
                {
                    candidates.Add((es2, ed.Identifier.GetLocation()));
                }
            }
            if (candidates.Count == 0) continue;

            // Every event symbol referenced anywhere in the type's bodies.
            var referenced = new HashSet<IEventSymbol>(SymbolEqualityComparer.Default);
            foreach (var id in typeDecl.DescendantNodes().OfType<IdentifierNameSyntax>())
                if (model.GetSymbolInfo(id).Symbol is IEventSymbol ev) referenced.Add(ev);

            foreach (var (sym, loc) in candidates)
            {
                if (referenced.Contains(sym)) continue;
                var pos = loc.GetLineSpan().StartLinePosition;
                yield return new Violation(
                    RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                    $"Event '{sym.Name}' is never raised in '{sym.ContainingType?.Name}' — its subscribers can never be notified.");
            }
        }
    }

    private static bool IsCandidate(IEventSymbol e)
    {
        if (e.IsVirtual || e.IsAbstract || e.IsOverride) return false;
        if (e.ExplicitInterfaceImplementations.Length > 0) return false;
        if (e.ContainingType?.TypeKind == TypeKind.Interface) return false;
        return true;
    }
}
