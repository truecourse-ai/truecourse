namespace ApiGateway.Violations.Bugs;

internal class ScheduleFormatter
{
    // VIOLATION: bugs/deterministic/loss-of-precision
    private const float MaxSequenceGap = 16777217f;

    // VIOLATION: bugs/deterministic/datetime-constructor-range
    private static readonly DateTime MaintenanceWindowStart = new DateTime(2024, 13, 1);

    private int _cursor;
    private int _retryBudget;
    private int _windowMinutes;

    internal int RetryBudget => _retryBudget;
    internal int WindowMinutes => _windowMinutes;

    internal bool IsInMaintenanceWindow(DateTime timestamp)
    {
        return timestamp >= MaintenanceWindowStart;
    }

    internal bool IsExpired(DateTime expiresUtc)
    {
        // VIOLATION: bugs/deterministic/datetime-without-timezone
        return DateTime.Now > expiresUtc;
    }

    internal string FormatStartTime(DateTime startedAt)
    {
        // VIOLATION: bugs/deterministic/datetime-12h-format-without-ampm
        return startedAt.ToString("hh:mm");
    }

    internal decimal ComputeSurcharge(decimal subtotal)
    {
        // VIOLATION: bugs/deterministic/decimal-from-float
        var rate = (decimal)0.0825;
        return subtotal * rate;
    }

    internal bool IsSequenceGapTooLarge(float gap)
    {
        return gap > MaxSequenceGap;
    }

    internal bool IsComplete(double progressPercent)
    {
        // VIOLATION: bugs/deterministic/float-equality-comparison
        return progressPercent == 100.0;
    }

    internal bool HasValidLatency(double latencyMs)
    {
        // VIOLATION: bugs/deterministic/nan-comparison
        return latencyMs != double.NaN;
    }

    internal int NextProbeOffset(int headerLength)
    {
        // VIOLATION: bugs/deterministic/confusing-increment-decrement
        return _cursor++ + headerLength;
    }

    internal void BumpRetryBudget()
    {
        // VIOLATION: bugs/deterministic/useless-increment
        _retryBudget = _retryBudget++;
    }

    internal void ApplyDiscountWindow(int discountMinutes)
    {
        // VIOLATION: bugs/deterministic/non-existent-operator
        _windowMinutes =- discountMinutes;
    }
}
