import type { ArchitectureDetector } from './types.js';
import { detectByChoiceSpecs, type ChoiceSpec } from './shared/detect.js';

const SPECS: ChoiceSpec[] = [
  { value: 'kafka', packages: ['kafkajs', '@kafkajs/confluent-schema-registry', 'kafka-python', 'confluent-kafka', 'aiokafka'] },
  { value: 'rabbitmq', packages: ['amqplib', 'amqp-connection-manager', 'pika', 'aio-pika', 'kombu'] },
  { value: 'sqs', packages: ['@aws-sdk/client-sqs'] },
  { value: 'nats', packages: ['nats', 'nats-py'] },
  { value: 'eventbridge', packages: ['@aws-sdk/client-eventbridge'] },
  { value: 'gcp-pubsub', packages: ['@google-cloud/pubsub'] },
  { value: 'azure-servicebus', packages: ['@azure/service-bus'] },
  { value: 'redis-pubsub', packages: ['ioredis', 'redis'] },
];

export const messagingDetector: ArchitectureDetector = {
  category: 'messaging',
  alternatives: [...SPECS.map((s) => s.value), 'none'],
  // Absence of every messaging client is itself a determinate answer:
  // `none`. The comparator turns that into an `unmet-choice` when the
  // spec asserts a specific broker.
  detect: (scan, scope) => detectByChoiceSpecs('messaging', scan, SPECS, { scope, absenceValue: 'none' }),
};
