using System;

namespace ApiGateway.Violations.Bugs;

/// <summary>
/// Reads a configured numeric threshold from its raw text form. The parse omits an
/// explicit IFormatProvider even though a culture-invariant overload exists, so the
/// value is locale-dependent — a comma-decimal culture misreads "1.5" as 15.
/// </summary>
internal sealed class ThresholdReader
{
    private readonly string _rawLimit;

    internal ThresholdReader(string rawLimit)
    {
        _rawLimit = rawLimit;
    }

    /// <summary>Parses the configured limit, dropping the invariant provider.</summary>
    internal double Limit()
    {
        // VIOLATION: bugs/deterministic/missing-format-provider-overload
        return double.Parse(_rawLimit);
    }
}
