namespace ApiGateway.Violations.Bugs;

[ServiceContract]
internal interface INotificationContract
{
    [OperationContract(IsOneWay = true)]
    // VIOLATION: bugs/deterministic/oneway-operation-non-void
    int Notify(string message);
}
