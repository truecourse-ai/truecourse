using System.Text.RegularExpressions;

namespace Shared.Utils;

public static class Validators
{
    public static bool ValidateEmail(string email)
    {
        var emailRegex = new Regex(@"^[^\s@]+@[^\s@]+\.[^\s@]+$");
        return emailRegex.IsMatch(email);
    }

    public static bool ValidateName(string name)
    {
        return name.Length >= 2 && name.Length <= 100;
    }
}
