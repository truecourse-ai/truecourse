namespace UserService.Violations.CodeQuality;

/// <summary>
/// Holds only static/const members and has no base type, yet declares a public
/// parameterless instance constructor. The constructor serves no purpose — there
/// is no instance state — so the type should be made <c>static</c>.
/// </summary>
internal sealed class StandaloneStaticHolder
{
    internal const string Key = "k";

    internal static int Width()
    {
        return 2;
    }

    // The empty public constructor on an all-static type is both a static-holder
    // artifact and a useless constructor (it does nothing the compiler default
    // wouldn't).
    // VIOLATION: code-quality/deterministic/static-holder-type-has-constructor
    // VIOLATION: code-quality/deterministic/useless-constructor
    public StandaloneStaticHolder()
    {
    }
}
