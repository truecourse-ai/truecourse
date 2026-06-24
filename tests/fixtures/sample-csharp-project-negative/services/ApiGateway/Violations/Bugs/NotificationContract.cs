namespace ApiGateway.Violations.Bugs;

[ServiceContract]
// VIOLATION: code-quality/deterministic/csharp-filename-type-mismatch
internal interface INotificationContract
{
    [OperationContract(IsOneWay = true)]
    // VIOLATION: bugs/deterministic/oneway-operation-non-void
    int Notify(string message);
}
