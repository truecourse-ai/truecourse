namespace ApiGatewayApp.Violations.CodeQuality;

// VIOLATION: code-quality/deterministic/enum-missing-zero-value
internal enum GatewayMode
{
    Primary = 1,
    Secondary = 2,
    Failover = 3,
}

// VIOLATION: code-quality/deterministic/unnecessary-declaration-semicolon
internal sealed class TrailingPunctuation
{
    internal int Value => 7;
};

// VIOLATION: code-quality/deterministic/too-many-type-parameters
internal sealed class Tuple3<TFirst, TSecond, TThird>
{
    internal TFirst First { get; }
    internal TSecond Second { get; }
    internal TThird Third { get; }

    internal Tuple3(TFirst first, TSecond second, TThird third)
    {
        First = first;
        Second = second;
        Third = third;
    }
}
