using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A `throw` statement in a member that callers assume cannot fail: finalizers,
/// Dispose(), Equals / GetHashCode / ToString overrides, operator==/!= and conversion
/// operators, the static constructor, and equality operators. An exception escaping
/// these is catastrophic (e.g. a finalizer crash terminates the process). We exclude
/// re-throws inside catch blocks (legitimate) and argument-validation throws are part
/// of the call contract for some members but not these. Needs the resolved member
/// symbol to classify it. S3877 / CA1065.
/// </summary>
internal sealed class ExceptionFromUnexpectedMember : ISemanticRule
{
    public string RuleKey => "bugs/deterministic/exception-from-unexpected-member";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        var root = tree.GetRoot();

        // Finalizers (~T).
        foreach (var dtor in root.DescendantNodes().OfType<DestructorDeclarationSyntax>())
            foreach (var v in Check(dtor.Body, "a finalizer", tree))
                yield return v;

        foreach (var method in root.DescendantNodes().OfType<MethodDeclarationSyntax>())
        {
            if (model.GetDeclaredSymbol(method) is not IMethodSymbol m) continue;
            var what = ClassifyMethod(m);
            if (what is null) continue;
            foreach (var v in Check((SyntaxNode?)method.Body ?? method.ExpressionBody, what, tree))
                yield return v;
        }

        foreach (var op in root.DescendantNodes().OfType<OperatorDeclarationSyntax>())
        {
            if (model.GetDeclaredSymbol(op) is not IMethodSymbol m) continue;
            // == and != commonly used in equality; comparison/equality operators must not throw.
            foreach (var v in Check((SyntaxNode?)op.Body ?? op.ExpressionBody, "an operator", tree))
                yield return v;
        }

        foreach (var conv in root.DescendantNodes().OfType<ConversionOperatorDeclarationSyntax>())
        {
            // Only IMPLICIT conversions must not throw; explicit conversions may.
            if (!conv.ImplicitOrExplicitKeyword.IsKind(SyntaxKind.ImplicitKeyword)) continue;
            foreach (var v in Check((SyntaxNode?)conv.Body ?? conv.ExpressionBody, "an implicit conversion operator", tree))
                yield return v;
        }

        // Static constructor.
        foreach (var ctor in root.DescendantNodes().OfType<ConstructorDeclarationSyntax>())
        {
            if (!ctor.Modifiers.Any(SyntaxKind.StaticKeyword)) continue;
            foreach (var v in Check((SyntaxNode?)ctor.Body ?? ctor.ExpressionBody, "a static constructor", tree))
                yield return v;
        }
    }

    private static string? ClassifyMethod(IMethodSymbol m)
    {
        if (!m.ReturnsVoid && m.Name is "GetHashCode" && m.Parameters.Length == 0 && m.IsOverride)
            return "GetHashCode";
        if (m is { Name: "ToString", Parameters.Length: 0, IsOverride: true })
            return "ToString";
        if (m is { Name: "Equals", Parameters.Length: 1, IsOverride: true })
            return "Equals";
        if (m is { Name: "Dispose", Parameters.Length: 0, ReturnsVoid: true } &&
            m.ContainingType.AllInterfaces.Any(i => i.SpecialType == SpecialType.System_IDisposable))
            return "Dispose";
        return null;
    }

    private static IEnumerable<Violation> Check(SyntaxNode? body, string what, SyntaxTree tree)
    {
        if (body is null) yield break;
        foreach (var thr in body.DescendantNodes().OfType<ThrowStatementSyntax>())
        {
            // A bare `throw;` re-throw inside a catch is legitimate cleanup-path propagation.
            if (thr.Expression is null) continue;
            if (InsideCatch(thr, body)) continue;
            var pos = thr.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                "bugs/deterministic/exception-from-unexpected-member",
                tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"Throwing from {what} is unsafe — callers assume it cannot fail, and an escaping exception here is catastrophic.");
        }
        // throw expressions (e.g. `=> throw new ...`) in an expression body.
        foreach (var thr in body.DescendantNodes().OfType<ThrowExpressionSyntax>())
        {
            if (InsideCatch(thr, body)) continue;
            var pos = thr.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                "bugs/deterministic/exception-from-unexpected-member",
                tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"Throwing from {what} is unsafe — callers assume it cannot fail, and an escaping exception here is catastrophic.");
        }
    }

    private static bool InsideCatch(SyntaxNode node, SyntaxNode stop)
    {
        for (var n = node.Parent; n is not null && n != stop.Parent; n = n.Parent)
            if (n is CatchClauseSyntax) return true;
        return false;
    }
}
