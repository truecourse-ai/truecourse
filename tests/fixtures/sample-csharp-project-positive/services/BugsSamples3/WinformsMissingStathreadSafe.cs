using System.Windows.Forms;

namespace Positive.Boundary.Bugs;

/// <summary>
/// A WinForms entry point that starts the message loop and is correctly marked
/// [STAThread], so the single-threaded-apartment requirement is satisfied and the
/// rule must not fire.
/// </summary>
public static class WinformsMissingStathreadSafe
{
    /// <summary>Boots the diagnostics window on an STA thread.</summary>
    // SAFE: bugs/deterministic/winforms-missing-stathread
    [STAThread]
    public static void Main()
    {
        Application.EnableVisualStyles();
        Application.Run(new Form());
    }
}
