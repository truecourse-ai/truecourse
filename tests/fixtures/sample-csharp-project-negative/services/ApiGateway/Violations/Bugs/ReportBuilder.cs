namespace ApiGateway.Violations.Bugs;

internal class ReportBuilder
{
    private readonly string _title;

    internal ReportBuilder(string title)
    {
        _title = title;
        // VIOLATION: bugs/deterministic/virtual-call-in-constructor
        Initialize();
    }

    protected virtual void Initialize()
    {
    }

    internal string Title => _title;
}
