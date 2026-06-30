namespace ApiGateway.Violations.Bugs;

internal enum RecursionGuardMode
{
    None,
    Linear,
}

internal sealed class InfiniteRecursionExpressionBodyProperty
{
    // An expression-bodied getter that returns the property itself (rather than
    // a backing field) recurses until StackOverflowException — even though the
    // property name coincides with the enum type `RecursionGuardMode`. This is
    // the genuine bug the rule must keep catching once auto-property
    // initializers (whose leading type identifier merely matches the name) are
    // exempted.
    // VIOLATION: bugs/deterministic/infinite-recursion
    internal RecursionGuardMode RecursionGuardMode => RecursionGuardMode;
}
