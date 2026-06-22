using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;

namespace ApiGateway.Violations.Bugs;

// Declares P/Invoke entry points and helpers with attribute misuse: an [Out] by-value
// string buffer, a [DefaultParameterValue] without [Optional] (so the default is dead),
// and a [DefaultValue] used where [DefaultParameterValue] is required.
internal static class NativeBridge
{
    // VIOLATION: architecture/deterministic/declarations-in-global-scope
    private static int _activePort = 8080;

    // VIOLATION: architecture/deterministic/declarations-in-global-scope
    private static int _maxRetries = 5;

    // [Out] on a by-value string can corrupt interned strings; the marshaller needs a
    // StringBuilder for a writable buffer.
    // VIOLATION: security/deterministic/pinvoke-no-dllimportsearchpath
    // VIOLATION: security/deterministic/pinvoke-string-marshalling-unspecified
    [DllImport("native")]
    internal static extern int ReadName(
        // VIOLATION: bugs/deterministic/pinvoke-out-string-parameter
        [Out] string buffer);

    // [DefaultParameterValue] without [Optional] never supplies a call-site default.
    internal static void Configure(
        // VIOLATION: bugs/deterministic/defaultparametervalue-without-optional
        [DefaultParameterValue(8080)] int port)
    {
        _activePort = port;
    }

    // [DefaultValue] (System.ComponentModel) is ignored for call-site defaulting.
    internal static void Tune(
        // VIOLATION: bugs/deterministic/defaultvalue-instead-of-defaultparametervalue
        [DefaultValue(5)] int retries)
    {
        _maxRetries = retries;
    }

    internal static int ActivePort => _activePort;

    internal static int MaxRetries => _maxRetries;
}

// Logs with caller information, but one call passes an explicit value for the
// [CallerMemberName] parameter, overriding the compiler-supplied caller name.
internal sealed class CallerAwareLogger
{
    // VIOLATION: code-quality/deterministic/prefer-string-empty
    private string _last = "";

    internal void Record(string message, [CallerMemberName] string member = "")
    {
        _last = $"{member}: {message}";
    }

    internal string Run()
    {
        // VIOLATION: bugs/deterministic/explicit-caller-info-argument
        Record("starting", "RunManually");
        return _last;
    }
}
