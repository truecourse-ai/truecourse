using System;
using System.Web.UI;

namespace ApiGateway.Violations.Security;

// VIOLATION: security/deterministic/viewstateuserkey-not-set
public partial class ViewStateBinding : Page
{
    // VIOLATION: security/deterministic/visible-event-handler
    protected void Page_Load(object sender, EventArgs e)
    {
        Response.Write("checkout");
    }
}
