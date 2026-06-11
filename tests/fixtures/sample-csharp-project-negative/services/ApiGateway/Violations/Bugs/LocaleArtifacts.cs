namespace ApiGateway.Violations.Bugs;

internal static class LocaleArtifacts
{
    // VIOLATION: bugs/deterministic/bidirectional-unicode
    internal const string ArchiveDisplayName = "report‮cod.txt";

    // VIOLATION: bugs/deterministic/invisible-whitespace
    internal const string GroupedAmountSample = "12 500";

    internal static bool IsArchiveAlias(string fileName)
    {
        return fileName == ArchiveDisplayName;
    }

    internal static bool UsesNarrowGrouping(string amount)
    {
        return amount == GroupedAmountSample;
    }
}
