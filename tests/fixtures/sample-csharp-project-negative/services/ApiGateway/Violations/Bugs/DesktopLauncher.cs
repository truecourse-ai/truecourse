using System.Windows.Forms;

namespace ApiGateway.Violations.Bugs;

/// <summary>
/// Boots a small diagnostics window. It starts the WinForms message loop but the entry
/// point is not marked [STAThread], so clipboard access and common dialogs misbehave.
/// </summary>
internal static class DesktopLauncher
{
    // VIOLATION: bugs/deterministic/winforms-missing-stathread
    internal static void Main()
    {
        Application.EnableVisualStyles();
        Application.Run(new Form());
    }
}
