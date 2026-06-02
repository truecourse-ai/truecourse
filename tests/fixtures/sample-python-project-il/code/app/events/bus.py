# ADR-003 mandates Kafka for inter-service messaging, but the event bus is
# an in-process callback registry and no Kafka client ships at all.
# IL-DRIFT: ArchitectureDecision:messaging.kafka / architecture.messaging.unmet-choice
_subscribers: dict = {}


def emit(name: str, payload: dict) -> None:
    for cb in _subscribers.get(name, []):
        cb(payload)
