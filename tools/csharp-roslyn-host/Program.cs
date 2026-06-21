using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

// ---------------------------------------------------------------------------
// Wire protocol — newline-delimited JSON over stdin/stdout. One request per
// line in, one response per line out. The Node analyzer spawns this process
// (the same way it spawns Pyright for Python) and queries it for the C# rules
// that need a semantic model. See README.md.
// ---------------------------------------------------------------------------

internal record FileInput(string Path, string Text);
internal record Request(string Op, List<FileInput>? Files, List<string>? Rules);
internal record Violation(string RuleKey, string Path, int Line, int Column, string Message);
internal record Response(bool Ok, List<Violation>? Violations = null, string? Error = null);

internal static class Program
{
    private static readonly List<MetadataReference> References = BuildReferences();

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private static int Main()
    {
        // Line-buffered request/response loop. Blocks until stdin closes.
        for (string? line; (line = Console.In.ReadLine()) is not null;)
        {
            if (string.IsNullOrWhiteSpace(line)) continue;
            Response resp;
            try
            {
                var req = JsonSerializer.Deserialize<Request>(line, JsonOpts)
                          ?? throw new InvalidOperationException("empty request");
                resp = Handle(req);
            }
            catch (Exception ex)
            {
                resp = new Response(false, Error: ex.Message);
            }
            Console.Out.WriteLine(JsonSerializer.Serialize(resp, JsonOpts));
            Console.Out.Flush();
        }
        return 0;
    }

    private static Response Handle(Request req) => req.Op switch
    {
        "ping" => new Response(true),
        "analyze" => Analyze(req),
        _ => new Response(false, Error: $"unknown op: {req.Op}"),
    };

    private static Response Analyze(Request req)
    {
        var files = req.Files ?? new List<FileInput>();
        var enabled = req.Rules is { Count: > 0 } ? new HashSet<string>(req.Rules) : null;

        var trees = files
            .Select(f => CSharpSyntaxTree.ParseText(f.Text, path: f.Path))
            .ToList();

        var compilation = CSharpCompilation.Create(
            "analysis", trees, References,
            new CSharpCompilationOptions(OutputKind.DynamicallyLinkedLibrary));

        var violations = new List<Violation>();
        foreach (var rule in SemanticRules.All)
        {
            if (enabled is not null && !enabled.Contains(rule.RuleKey)) continue;
            foreach (var tree in trees)
            {
                var model = compilation.GetSemanticModel(tree);
                violations.AddRange(rule.Analyze(model, tree));
            }
        }
        return new Response(true, Violations: violations);
    }

    // Reference set = the running runtime's trusted platform assemblies, so the
    // semantic model resolves System.* / framework types exactly. (A later phase
    // swaps this for MSBuildWorkspace-loaded project references for full fidelity.)
    private static List<MetadataReference> BuildReferences()
    {
        var tpa = (AppContext.GetData("TRUSTED_PLATFORM_ASSEMBLIES") as string ?? string.Empty)
            .Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries);
        var refs = new List<MetadataReference>();
        foreach (var path in tpa)
        {
            try { refs.Add(MetadataReference.CreateFromFile(path)); }
            catch { /* skip unreadable assemblies */ }
        }
        return refs;
    }
}

internal interface ISemanticRule
{
    string RuleKey { get; }
    IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree);
}

internal static class SemanticRules
{
    // The C# rules that need a semantic model. Each new rule from the Roslyn
    // track is added here, mirroring how tree-sitter rules register in the
    // analyzer's *_CSHARP_VISITORS arrays.
    public static readonly IReadOnlyList<ISemanticRule> All = new ISemanticRule[]
    {
        new ReferenceEqualsOnValueType(),
    };
}

/// <summary>
/// `object.ReferenceEquals(a, b)` where an argument is a value type. Value types
/// are boxed into separate objects, so ReferenceEquals is always false — a real
/// bug that pure syntax cannot catch (it requires the argument's resolved type).
/// (Sonar S2995 / Roslyn CA2013.)
/// </summary>
internal sealed class ReferenceEqualsOnValueType : ISemanticRule
{
    public string RuleKey => "bugs/deterministic/referenceequals-on-value-type";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var inv in tree.GetRoot().DescendantNodes().OfType<InvocationExpressionSyntax>())
        {
            if (model.GetSymbolInfo(inv).Symbol is not IMethodSymbol m) continue;
            if (m.Name != "ReferenceEquals" || m.ContainingType?.SpecialType != SpecialType.System_Object) continue;

            foreach (var arg in inv.ArgumentList.Arguments)
            {
                var type = model.GetTypeInfo(arg.Expression).Type;
                if (type is { IsValueType: true } && type.SpecialType != SpecialType.System_Void)
                {
                    var pos = inv.GetLocation().GetLineSpan().StartLinePosition;
                    yield return new Violation(
                        RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                        "object.ReferenceEquals on a value type is always false — the arguments are boxed into distinct objects.");
                    break;
                }
            }
        }
    }
}
