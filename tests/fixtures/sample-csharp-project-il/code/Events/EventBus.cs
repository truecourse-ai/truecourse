// ADR-003 mandates Kafka for inter-service messaging, but the event bus is an
// in-process callback registry and no Kafka client ships at all.
// IL-DRIFT: ArchitectureDecision:messaging.kafka / architecture.messaging.unmet-choice
namespace SampleApi.Events;

public class EventBus
{
    private readonly Dictionary<string, List<Action<object>>> _subscribers = new();

    public void Subscribe(string name, Action<object> callback)
    {
        if (!_subscribers.TryGetValue(name, out var list))
        {
            list = new List<Action<object>>();
            _subscribers[name] = list;
        }

        list.Add(callback);
    }

    public void Emit(string name, object payload)
    {
        if (_subscribers.TryGetValue(name, out var list))
        {
            foreach (var callback in list)
            {
                callback(payload);
            }
        }
    }
}
