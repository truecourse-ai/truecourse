using Xunit;

namespace UserServiceApp.Violations.CodeQuality;

internal class OrderCalculatorTests
{
    private static int _sharedSeed = 7;

    // VIOLATION: code-quality/deterministic/test-skipped
    [Fact(Skip = "Carrier sandbox is offline")]
    public void Total_AppliesCarrierSurcharge()
    {
        var calculator = new OrderCalculator();
        Assert.Equal(42m, calculator.Total(120m, 2));
    }

    // VIOLATION: code-quality/deterministic/test-missing-assertion
    [Fact]
    public void Recalculate_DoesNotThrow()
    {
        var calculator = new OrderCalculator();
        calculator.Recalculate(120m);
    }

    [Fact]
    public void Subtotal_MatchesLedgerRate()
    {
        var calculator = new OrderCalculator();
        // VIOLATION: code-quality/deterministic/test-inverted-arguments
        Assert.Equal(calculator.Subtotal(120m, 2), 19.5m);
    }

    [Fact]
    public void Total_RoundTripsThroughLedger()
    {
        var calculator = new OrderCalculator();
        var posted = calculator.Post(120m);
        // VIOLATION: code-quality/deterministic/test-same-argument
        Assert.Equal(posted.Total, posted.Total);
    }

    [Fact]
    public void Ledger_IsBalancedAfterPost()
    {
        var calculator = new OrderCalculator();
        calculator.Post(120m);
        // VIOLATION: code-quality/deterministic/unconditional-assertion
        Assert.True(true);
    }

    [Fact]
    public void Validate_RejectsMissingOrder()
    {
        var calculator = new OrderCalculator();
        // VIOLATION: code-quality/deterministic/test-missing-exception-check
        Assert.Throws<Exception>(() => calculator.Validate(null));
    }

    // VIOLATION: code-quality/deterministic/flaky-test
    [Fact]
    public void Receipt_StampIsRecent()
    {
        var calculator = new OrderCalculator();
        var receipt = calculator.Post(120m);
        Assert.True(receipt.CreatedAt <= DateTime.UtcNow);
    }

    // VIOLATION: code-quality/deterministic/test-with-hardcoded-timeout
    [Fact]
    public void Recalculate_SettlesAfterQueueDrain()
    {
        var calculator = new OrderCalculator();
        calculator.Recalculate(120m);
        Thread.Sleep(1500);
        Assert.True(calculator.IsSettled);
    }

    // VIOLATION: code-quality/deterministic/disabled-test-timeout
    [Fact(Timeout = 600000)]
    public void Post_CompletesUnderLoad()
    {
        var calculator = new OrderCalculator();
        var posted = calculator.Post(120m);
        Assert.NotNull(posted);
    }

    [Fact]
    public void Recalculate_UsesSeededOffset()
    {
        var calculator = new OrderCalculator();
        // VIOLATION: code-quality/deterministic/test-modifying-global-state
        // VIOLATION: bugs/deterministic/instance-writes-static-field
        _sharedSeed = 11;
        Assert.Equal(11, _sharedSeed + calculator.Offset(0));
    }
}
