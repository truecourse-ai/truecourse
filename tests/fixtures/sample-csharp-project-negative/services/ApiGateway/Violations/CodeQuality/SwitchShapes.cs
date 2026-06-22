namespace ApiGatewayApp.Violations.CodeQuality;

internal sealed class SwitchShapes
{
    internal void Dispatch(int code, IHandler handler)
    {
        switch (code)
        {
            case 1:
                handler.HandlePrimary();
                break;
            case 2:
                handler.HandleSecondary();
                break;
            // VIOLATION: code-quality/deterministic/redundant-default-switch-section
            default:
                break;
        }
    }
}
