namespace Shared.Utils;

public class Logger
{
    public void Info(string message, params object[] args)
    {
        Console.WriteLine($"[INFO] {message}", args);
    }

    public void Error(string message, params object[] args)
    {
        Console.WriteLine($"[ERROR] {message}", args);
    }

    public void Warn(string message, params object[] args)
    {
        Console.WriteLine($"[WARN] {message}", args);
    }


    public static readonly Logger Instance = new Logger();
}
