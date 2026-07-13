using System;
using System.Threading.Tasks;

namespace Demo.Events;

/// <summary>Event payload describing a data change.</summary>
public class DataChangedEventArgs : EventArgs
{
    /// <summary>Gets the number of changed rows.</summary>
    public int ChangedCount { get; init; }
}

/// <summary>Handles data-change notifications raised by a source.</summary>
public class DataChangeListener
{
    /// <summary>Handles a source change; event handlers omit the Async suffix.</summary>
    public async Task OnSourceChanged(object? sender, DataChangedEventArgs e)
    {
        Console.WriteLine(sender);
        await Task.Delay(e.ChangedCount);
    }
}
