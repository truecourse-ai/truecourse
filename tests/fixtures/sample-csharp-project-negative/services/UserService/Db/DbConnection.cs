namespace UserServiceApp.Db;

public static class DbConnection
{
    private static string? _connectionString;

    public static void ConnectDatabase()
    {
        if (_connectionString == null)
        {
            _connectionString = "Host=localhost;Port=5432;Database=app;Username=app;Password=secret";
        }
    }

    public static void DisconnectDatabase()
    {
        _connectionString = null;
    }
}
