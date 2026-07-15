namespace UserServiceApp.Violations.CodeQuality;

internal class ThresholdSelector
{
    internal int Pick(bool isHigh, int high, int low)
    {
        int result;
        // VIOLATION: code-quality/deterministic/if-else-instead-of-ternary
        if (isHigh)
        {
            result = high;
        }
        else
        {
            result = low;
        }
        return result;
    }
}
