namespace Positive.Boundary.CodeQuality;

/// <summary>Pipeline whose method holds exactly the fifteen-name local budget.</summary>
public sealed class TooManyLocalsSafe
{
    /// <summary>Blends three weights through a chain of intermediates; three parameters plus twelve locals is the allowed maximum of fifteen.</summary>
    internal int Blend(int seed, int factor, int offset)
    {
        // SAFE: code-quality/deterministic/too-many-locals
        var step1 = seed + factor;
        var step2 = step1 + offset;
        var step3 = step2 + factor;
        var step4 = step3 + seed;
        var step5 = step4 + offset;
        var step6 = step5 + factor;
        var step7 = step6 + seed;
        var step8 = step7 + offset;
        var step9 = step8 + factor;
        var step10 = step9 + seed;
        var step11 = step10 + offset;
        var step12 = step11 + factor;
        return step12 - step1;
    }
}
