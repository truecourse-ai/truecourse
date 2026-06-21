using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A tuple element accessed by its positional metadata name (`Item1`, `Item2`, …)
/// when the tuple's static type declares an explicit element name for that position
/// (e.g. `(int Count, string Name)`). Referencing the named element reads far better.
/// Needs the receiver's resolved tuple type to know a friendlier name exists. SA1142.
/// </summary>
internal sealed class TupleElementByName : ISemanticRule
{
    public string RuleKey => "code-quality/deterministic/tuple-element-by-name";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var access in tree.GetRoot().DescendantNodes().OfType<MemberAccessExpressionSyntax>())
        {
            var member = access.Name.Identifier.ValueText;
            if (!IsItemName(member, out var position)) continue;

            // The receiver must be a tuple type that gives this position a friendly name.
            var recvType = model.GetTypeInfo(access.Expression).Type;
            if (recvType is not INamedTypeSymbol { IsTupleType: true } tuple) continue;

            var elements = tuple.TupleElements;
            if (position < 1 || position > elements.Length) continue;
            var element = elements[position - 1];

            // A friendly name exists when the element's declared name differs from its
            // default ItemN name (CanBeReferencedByName guards generated/keyword names).
            var friendly = element.Name;
            if (string.IsNullOrEmpty(friendly) || friendly == member) continue;
            if (!element.CanBeReferencedByName) continue;

            var pos = access.Name.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"Tuple element accessed as '{member}'; use the declared element name '{friendly}' instead.");
        }
    }

    /// True for "Item1".."Item99"; sets the 1-based element position.
    private static bool IsItemName(string name, out int position)
    {
        position = 0;
        if (!name.StartsWith("Item", StringComparison.Ordinal)) return false;
        var rest = name.AsSpan(4);
        if (rest.Length == 0) return false;
        return int.TryParse(rest, out position) && position >= 1;
    }
}
