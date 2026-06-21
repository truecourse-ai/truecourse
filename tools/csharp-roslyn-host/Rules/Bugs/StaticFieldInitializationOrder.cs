using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A static field initializer that reads another static field of the SAME type
/// declared textually later. Static initializers run in declaration order, so the
/// later field is still at its default when this one reads it — a silent
/// wrong-value bug. Needs symbol resolution + declaration order. S3263.
/// </summary>
internal sealed class StaticFieldInitializationOrder : ISemanticRule
{
    public string RuleKey => "bugs/deterministic/static-field-initialization-order";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var typeDecl in tree.GetRoot().DescendantNodes().OfType<TypeDeclarationSyntax>())
        {
            if (model.GetDeclaredSymbol(typeDecl) is not INamedTypeSymbol type) continue;

            // Record each static field's textual position (token span start) keyed by symbol.
            var order = new Dictionary<ISymbol, int>(SymbolEqualityComparer.Default);
            var initializers = new List<(VariableDeclaratorSyntax decl, int pos, IFieldSymbol sym)>();

            foreach (var fieldDecl in typeDecl.Members.OfType<FieldDeclarationSyntax>())
            {
                if (!fieldDecl.Modifiers.Any(m => m.Text == "static")) continue;
                foreach (var v in fieldDecl.Declaration.Variables)
                {
                    if (model.GetDeclaredSymbol(v) is not IFieldSymbol fs) continue;
                    var span = v.SpanStart;
                    order[fs] = span;
                    if (v.Initializer is not null)
                        initializers.Add((v, span, fs));
                }
            }

            foreach (var (decl, pos, _) in initializers)
            {
                foreach (var id in decl.Initializer!.Value.DescendantNodesAndSelf().OfType<IdentifierNameSyntax>())
                {
                    if (model.GetSymbolInfo(id).Symbol is not IFieldSymbol referenced) continue;
                    if (!referenced.IsStatic || referenced.IsConst) continue;
                    if (!order.TryGetValue(referenced, out var refPos)) continue;
                    // The referenced static field is declared strictly later in the same type.
                    if (refPos <= pos) continue;

                    var lp = id.GetLocation().GetLineSpan().StartLinePosition;
                    yield return new Violation(
                        RuleKey, tree.FilePath, lp.Line + 1, lp.Character + 1,
                        $"Static field initializer reads '{referenced.Name}', which is declared later; due to textual initialization order it is still at its default value here.");
                    break;
                }
            }
        }
    }
}
