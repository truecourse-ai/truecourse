using System;
using System.Web.UI;

namespace Positive.Boundary.Security;

/// <summary>Web Forms page that binds its view-state to the current session.</summary>
// SAFE: security/deterministic/viewstateuserkey-not-set
public partial class ViewstateuserkeyNotSetSafe : Page
{
    /// <summary>Sets the per-session view-state key before the page initializes.</summary>
    protected override void OnInit(EventArgs e)
    {
        ViewStateUserKey = Session.SessionID;
        base.OnInit(e);
    }
}
