using System.Threading.Tasks;
using Microsoft.CodeAnalysis.CSharp.Scripting;

namespace Positive.Boundary.Security;

/// <summary>Runs a fixed, constant script through the scripting engine.</summary>
public sealed class EvalUsageSafe
{
    /// <summary>Evaluates a hard-coded expression and returns its result.</summary>
    internal Task<int> EvaluateConstant()
    {
        // SAFE: security/deterministic/eval-usage
        return CSharpScript.EvaluateAsync<int>("40 + 2");
    }
}
