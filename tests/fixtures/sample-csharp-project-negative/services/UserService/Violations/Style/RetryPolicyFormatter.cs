// VIOLATION: style/deterministic/sorting-style
using System.Text;
using System.Linq;
using System;
using System.Collections.Generic;

namespace UserServiceApp.Violations.Style;

internal sealed class RetryPolicyFormatter
{
    // VIOLATION: style/deterministic/csharp-naming-convention
    private readonly int _base_delay_ms;

    internal RetryPolicyFormatter(int baseDelayMs)
    {
        _base_delay_ms = baseDelayMs;
    }

    // VIOLATION: style/deterministic/docstring-completeness

    public TimeSpan DelayFor(int attempt)
    {
        // VIOLATION: style/deterministic/comment-tag-formatting
        // XXX cap the backoff once the gateway publishes its rate limits
        var backoffMs = _base_delay_ms * attempt;
        // VIOLATION: style/deterministic/unnecessary-parentheses-style
        return (TimeSpan.FromMilliseconds(backoffMs));
    }

    internal string Describe(IEnumerable<int> attempts)
    {
        var schedule = new StringBuilder();
        foreach (var attempt in attempts.OrderBy(a => a))
        {
            // VIOLATION: style/deterministic/whitespace-formatting
	        schedule.AppendLine($"attempt {attempt}: wait {DelayFor(attempt).TotalMilliseconds}ms");
        }
        return schedule.ToString();
    }
}
