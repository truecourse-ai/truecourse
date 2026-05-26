import { EventEmitter } from 'node:events';

// ADR-003 mandates Kafka for inter-service messaging, but the event bus is
// an in-process Node EventEmitter and no Kafka client ships at all.
// IL-DRIFT: ArchitectureDecision:messaging.kafka / architecture.messaging.unmet-choice
export const events = new EventEmitter();

export interface OrderEvent {
  id: string;
  status: string;
  at: string;
}
