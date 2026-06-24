using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// `Buffer.BlockCopy(src, srcOffset, dst, dstOffset, count)` where the count argument
/// is `someArray.Length` but the array's element type is larger than one byte.
/// BlockCopy counts BYTES, so passing the element count copies only a fraction of the
/// data. Needs the array element type to know its byte size. CA2018.
/// </summary>
internal sealed class BlockCopyWrongCount : ISemanticRule
{
    public string RuleKey => "bugs/deterministic/blockcopy-wrong-count";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var inv in tree.GetRoot().DescendantNodes().OfType<InvocationExpressionSyntax>())
        {
            if (inv.Expression is not MemberAccessExpressionSyntax ma) continue;
            if (ma.Name.Identifier.Text != "BlockCopy") continue;
            if (inv.ArgumentList.Arguments.Count != 5) continue;

            if (model.GetSymbolInfo(inv).Symbol is not IMethodSymbol m) continue;
            if (m.Name != "BlockCopy" ||
                m.ContainingType is not { Name: "Buffer", ContainingNamespace.Name: "System" })
                continue;

            // count = the 5th argument; look for `X.Length` and resolve X's element type.
            if (inv.ArgumentList.Arguments[4].Expression is not MemberAccessExpressionSyntax countMa) continue;
            if (countMa.Name.Identifier.Text != "Length") continue;

            var arrType = model.GetTypeInfo(countMa.Expression).Type;
            if (arrType is not IArrayTypeSymbol arr) continue;
            if (ElementByteSize(arr.ElementType) is not { } size || size <= 1) continue;

            var pos = inv.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"Buffer.BlockCopy count is an array's .Length but the elements are {size} bytes each — BlockCopy counts bytes, so only 1/{size} of the data is copied. Multiply by sizeof(element) or use Buffer.ByteLength.");
        }
    }

    private static int? ElementByteSize(ITypeSymbol t) => t.SpecialType switch
    {
        SpecialType.System_Byte or SpecialType.System_SByte or SpecialType.System_Boolean => 1,
        SpecialType.System_Char or SpecialType.System_Int16 or SpecialType.System_UInt16 => 2,
        SpecialType.System_Int32 or SpecialType.System_UInt32 or SpecialType.System_Single => 4,
        SpecialType.System_Int64 or SpecialType.System_UInt64 or SpecialType.System_Double => 8,
        _ => null,
    };
}
