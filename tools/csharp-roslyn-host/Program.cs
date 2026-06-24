using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Build.Locator;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.MSBuild;

namespace TrueCourse.RoslynHost;

// ---------------------------------------------------------------------------
// Wire protocol — newline-delimited JSON over stdin/stdout. One request per
// line in, one response per line out. The Node analyzer spawns this process
// (the same way it spawns Pyright for Python) and queries it for the C# rules
// that need a semantic model. See README.md.
//
// Two analysis modes:
//   "analyze"         loose file texts compiled with the runtime's reference
//                     set — fast, no restore needed (build-free host rules).
//   "analyze-project" a real .csproj/.sln opened via MSBuildWorkspace with its
//                     actual references — full fidelity, unlocks the rules that
//                     need project metadata or framework types. Requires a
//                     restored, buildable project (fail-hard if not).
// ---------------------------------------------------------------------------

internal record FileInput(string Path, string Text);
internal record Request(string Op, List<FileInput>? Files, List<string>? Rules, string? Project);
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
        // Register an installed .NET SDK with MSBuildLocator before any MSBuild
        // type is touched (the analyze-project path). Must run first.
        if (!MSBuildLocator.IsRegistered) MSBuildLocator.RegisterDefaults();

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
        "analyze-project" => AnalyzeProject(req).GetAwaiter().GetResult(),
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

    // Open a real project/solution via MSBuildWorkspace and run every host rule
    // (single-model and project-aware) against its documents with the project's
    // own references. NoInlining: keeps MSBuild types out of Main's JIT body so
    // MSBuildLocator.RegisterDefaults runs before they resolve.
    [MethodImpl(MethodImplOptions.NoInlining)]
    private static async Task<Response> AnalyzeProject(Request req)
    {
        if (string.IsNullOrWhiteSpace(req.Project))
            return new Response(false, Error: "analyze-project requires a 'project' path (.csproj or .sln)");
        if (!File.Exists(req.Project))
            return new Response(false, Error: $"project not found: {req.Project}");

        var enabled = req.Rules is { Count: > 0 } ? new HashSet<string>(req.Rules) : null;

        using var workspace = MSBuildWorkspace.Create();
        var failures = new List<string>();
        workspace.WorkspaceFailed += (_, e) =>
        {
            if (e.Diagnostic.Kind == WorkspaceDiagnosticKind.Failure) failures.Add(e.Diagnostic.Message);
        };

        var projects = new List<Project>();
        if (req.Project.EndsWith(".sln", StringComparison.OrdinalIgnoreCase))
        {
            var solution = await workspace.OpenSolutionAsync(req.Project);
            projects.AddRange(solution.Projects);
        }
        else
        {
            projects.Add(await workspace.OpenProjectAsync(req.Project));
        }

        var violations = new List<Violation>();
        var seen = new HashSet<string>();
        var sawCSharp = false;

        foreach (var project in projects)
        {
            if (project.Language != LanguageNames.CSharp) continue;
            var compilation = await project.GetCompilationAsync();
            if (compilation is null) continue;
            sawCSharp = true;

            // Fail-hard: an unrestored project loses its reference set, so the
            // model can't even resolve System.Object — every type-dependent rule
            // would misfire. Refuse rather than emit untrustworthy violations.
            if (compilation.GetSpecialType(SpecialType.System_Object).TypeKind == TypeKind.Error)
            {
                var hint = failures.Count > 0 ? $" First failure: {failures[0]}" : string.Empty;
                return new Response(false, Error:
                    $"project '{project.Name}' loaded without a reference set — run `dotnet restore` " +
                    $"(and ensure the targeted SDK is installed).{hint}");
            }

            var ctx = new ProjectContext(
                project.FilePath ?? string.Empty,
                Path.GetDirectoryName(project.FilePath) ?? string.Empty,
                project.DefaultNamespace,
                project.AssemblyName,
                compilation.Options.OutputKind);

            // Real source documents only. The SDK injects generated compile items
            // (e.g. obj/.../AssemblyInfo.cs) into the project; skip anything under
            // the intermediate (obj) or output (bin) folders so violations are
            // never attributed to generated files.
            foreach (var doc in project.Documents)
            {
                if (IsGeneratedPath(ctx.ProjectDirectory, doc.FilePath)) continue;
                var model = await doc.GetSemanticModelAsync();
                var tree = model?.SyntaxTree;
                if (model is null || tree is null) continue;

                foreach (var rule in SemanticRules.All)
                {
                    if (enabled is not null && !enabled.Contains(rule.RuleKey)) continue;
                    foreach (var v in rule.Analyze(model, tree)) AddDedup(violations, seen, v);
                }
                foreach (var rule in SemanticRules.ProjectAware)
                {
                    if (enabled is not null && !enabled.Contains(rule.RuleKey)) continue;
                    foreach (var v in rule.Analyze(ctx, model, tree)) AddDedup(violations, seen, v);
                }
            }
        }

        if (!sawCSharp)
            return new Response(false, Error: $"no C# project loaded from {req.Project}");

        return new Response(true, Violations: violations);
    }

    // True for documents under the project's obj/ or bin/ folders — generated
    // output the SDK adds as compile items, not authored source.
    private static bool IsGeneratedPath(string projectDir, string? filePath)
    {
        if (string.IsNullOrEmpty(filePath) || string.IsNullOrEmpty(projectDir)) return false;
        var rel = Path.GetRelativePath(projectDir, filePath)
            .Replace(Path.DirectorySeparatorChar, '/');
        return rel.StartsWith("obj/", StringComparison.OrdinalIgnoreCase)
            || rel.StartsWith("bin/", StringComparison.OrdinalIgnoreCase)
            || rel.Contains("/obj/", StringComparison.OrdinalIgnoreCase)
            || rel.Contains("/bin/", StringComparison.OrdinalIgnoreCase);
    }

    // A document can be linked into multiple projects of a solution; dedupe so a
    // violation reported per-project collapses to one per (rule, file, position).
    private static void AddDedup(List<Violation> acc, HashSet<string> seen, Violation v)
    {
        if (seen.Add($"{v.RuleKey}\0{v.Path}\0{v.Line}\0{v.Column}")) acc.Add(v);
    }

    // Reference set for the loose-text `analyze` mode = the running runtime's
    // trusted platform assemblies, so the semantic model resolves System.* /
    // framework types. `analyze-project` uses the project's real references.
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

/// <summary>Single-compilation rule: needs only the semantic model + tree.</summary>
internal interface ISemanticRule
{
    string RuleKey { get; }
    IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree);
}

/// <summary>
/// Project-scoped rule: also needs project metadata (RootNamespace, output kind,
/// project directory, assembly name). Only runs in `analyze-project` mode — these
/// rules are meaningless without a real project, so their absence in loose-text
/// mode is "not applicable", not a degraded result.
/// </summary>
internal interface IProjectAwareRule
{
    string RuleKey { get; }
    IEnumerable<Violation> Analyze(ProjectContext ctx, SemanticModel model, SyntaxTree tree);
}

/// <summary>Project facts not derivable from the <see cref="Compilation"/> alone.</summary>
internal sealed record ProjectContext(
    string ProjectFilePath,
    string ProjectDirectory,
    string? RootNamespace,
    string? AssemblyName,
    OutputKind OutputKind);

internal static class SemanticRules
{
    // Auto-discovered: every non-abstract ISemanticRule in the assembly is
    // registered. Adding a rule = adding a file under Rules/<Domain>/ with a
    // class implementing ISemanticRule (parameterless ctor) — no central edit,
    // so parallel rule authoring never conflicts on a shared registry.
    public static readonly IReadOnlyList<ISemanticRule> All =
        Discover<ISemanticRule>(r => r.RuleKey);

    // Same, for the project-aware rules (analyze-project mode only).
    public static readonly IReadOnlyList<IProjectAwareRule> ProjectAware =
        Discover<IProjectAwareRule>(r => r.RuleKey);

    private static IReadOnlyList<T> Discover<T>(Func<T, string> keyOf) =>
        typeof(SemanticRules).Assembly.GetTypes()
            .Where(t => t is { IsAbstract: false, IsInterface: false } && typeof(T).IsAssignableFrom(t))
            .Select(t => (T)Activator.CreateInstance(t)!)
            .OrderBy(keyOf, StringComparer.Ordinal)
            .ToArray();
}
