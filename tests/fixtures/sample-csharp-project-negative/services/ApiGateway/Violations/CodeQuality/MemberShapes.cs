namespace ApiGatewayApp.Violations.CodeQuality;

internal sealed class MemberShapes
{
    // VIOLATION: code-quality/deterministic/prefer-tuple-syntax
    internal ValueTuple<int, string> Describe()
    {
        return default;
    }

    internal void Wire(Action<int> register)
    {
        // VIOLATION: code-quality/deterministic/prefer-lambda-over-delegate
        register(delegate(int code) { Track(code); });
    }

    private void Track(int code)
    {
        _last = code;
    }

    private int _last;

    internal int Last => _last;

    // VIOLATION: code-quality/deterministic/out-ref-parameter-usage
    public int Divide(int a, int b, out int remainder)
    {
        remainder = a % b;
        return a / b;
    }

    // VIOLATION: code-quality/deterministic/too-many-generic-parameters
    internal TResult Combine<TFirst, TSecond, TResult>(TFirst first, TSecond second)
    {
        Track(first?.GetHashCode() ?? 0);
        Track(second?.GetHashCode() ?? 0);
        return default!;
    }

    // VIOLATION: code-quality/deterministic/unnecessary-raw-string
    internal string Header => """Daily Report""";

    // VIOLATION: code-quality/deterministic/unnecessary-string-interpolation
    internal string SelfName => $"{nameof(MemberShapes)}";

    // VIOLATION: code-quality/deterministic/typeof-name-over-typeof-name
    internal string TypeLabel => typeof(MemberShapes).Name;

    // VIOLATION: code-quality/deterministic/prefer-unix-epoch-field
    // VIOLATION: code-quality/deterministic/magic-number
    internal DateTime Epoch => new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc);
}

internal sealed class EventRaiser
{
    internal event EventHandler Flushed;

    // VIOLATION: code-quality/deterministic/non-generic-event-handler
    internal event FlushCompletedHandler FlushCompleted;

    // VIOLATION: code-quality/deterministic/event-before-after-prefix
    internal event EventHandler BeforeFlush;

    internal delegate void FlushCompletedHandler(object sender, EventArgs e);

    // A nested non-flags enum with a plural name — exercises the plural-name
    // rule without introducing a top-level type.
    // VIOLATION: code-quality/deterministic/non-flags-enum-plural-name
    internal enum FlushPhases
    {
        Idle,
        Draining,
        Complete
    }

    internal void Flush()
    {
        // VIOLATION: code-quality/deterministic/use-eventargs-empty
        Flushed?.Invoke(this, new EventArgs());
        BeforeFlush?.Invoke(this, EventArgs.Empty);
        FlushCompleted?.Invoke(this, EventArgs.Empty);
    }

    internal void Describe(object source)
    {
        // VIOLATION: code-quality/deterministic/use-is-over-as-null-check
        var label = source as string;
        if (label != null)
        {
            Console.WriteLine(label);
        }
    }

    internal void Drain(Action work)
    {
        try
        {
            work();
        }
        // VIOLATION: code-quality/deterministic/mergeable-catch-clauses
        catch (TimeoutException)
        {
            Console.WriteLine("retryable");
        }
        catch (System.IO.IOException)
        {
            Console.WriteLine("retryable");
        }
    }

    internal void Pump(System.Threading.CancellationToken token)
    {
        // VIOLATION: code-quality/deterministic/use-throwifcancellationrequested
        if (token.IsCancellationRequested)
        {
            throw new OperationCanceledException();
        }
    }
}
