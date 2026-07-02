import { jest } from '@jest/globals';
import { Partitioners } from 'kafkajs';
import { createKafkaLogPolicy } from '../app/kafka/log-policy.js';
import { prepareTreasuryTopic } from '../app/kafka/topic-readiness.js';
import {
  buildProgramReconciledMessage,
  publishTreasuryMessage,
} from './kafka-producer.js';

const TOPIC = 'treasury.capacity.events';
const READINESS = {
  attempts: 1,
  delayMs: 0,
};
const TOPIC_CONFIG = {
  numPartitions: 1,
  replicationFactor: 1,
};
const PAYLOAD = {
  messageId: 'treasury-msg-1',
  schemaVersion: 1,
  eventType: 'RESERVATION_APPROVED',
  occurredAt: '2026-07-02T12:00:00.000Z',
  programId: 'program-1',
  invoiceId: 'invoice-1',
  amount: 100,
  currency: 'EUR',
};
const ENV_KEYS = [
  'KAFKA_BROKERS',
  'KAFKA_CLIENT_ID',
  'KAFKA_TREASURY_EVENTS_TOPIC',
  'PROGRAM_ID',
  'MESSAGE_ID',
  'OCCURRED_AT',
  'TOTAL_LIMIT',
  'RESERVED_AMOUNT',
  'CURRENCY',
];
const ORIGINAL_ENV = ENV_KEYS.reduce((env, key) => ({
  ...env,
  [key]: process.env[key],
}), {});

const restoreEnv = () => {
  for (const key of ENV_KEYS) {
    if (ORIGINAL_ENV[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = ORIGINAL_ENV[key];
    }
  }
};

const createMockLogger = () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
});

const createMockAdmin = ({ existingTopics = [TOPIC], createTopicsError } = {}) => ({
  connect: jest.fn().mockResolvedValue(undefined),
  listTopics: jest.fn().mockResolvedValue(existingTopics),
  createTopics: createTopicsError
    ? jest.fn().mockRejectedValue(createTopicsError)
    : jest.fn().mockResolvedValue(true),
  fetchTopicMetadata: jest.fn().mockResolvedValue({
    topics: [{ name: TOPIC }],
  }),
  disconnect: jest.fn().mockResolvedValue(undefined),
});

const createMockProducer = () => ({
  connect: jest.fn().mockResolvedValue(undefined),
  send: jest.fn().mockResolvedValue(undefined),
  disconnect: jest.fn().mockResolvedValue(undefined),
});

const createMockKafkaClient = ({ admin = createMockAdmin(), producer = createMockProducer() } = {}) => ({
  admin: jest.fn().mockReturnValue(admin),
  producer: jest.fn().mockReturnValue(producer),
});

const publishWithMocks = async ({
  admin = createMockAdmin(),
  producer = createMockProducer(),
  logger = createMockLogger(),
} = {}) => {
  const kafkaClient = createMockKafkaClient({ admin, producer });
  const kafkaClientFactory = jest.fn().mockReturnValue(kafkaClient);
  const promise = publishTreasuryMessage(PAYLOAD, {
    kafkaClientFactory,
    kafkaLogPolicyFactory: createKafkaLogPolicy,
    logger,
    prepareTopic: prepareTreasuryTopic,
    readiness: READINESS,
    topicConfig: TOPIC_CONFIG,
  });

  return {
    result: await promise,
    admin,
    producer,
    kafkaClient,
    kafkaClientFactory,
    logger,
  };
};

describe('Kafka producer scripts', () => {
  beforeEach(() => {
    process.env.KAFKA_BROKERS = 'localhost:9092';
    process.env.KAFKA_CLIENT_ID = 'cir-producer-test';
    process.env.KAFKA_TREASURY_EVENTS_TOPIC = TOPIC;
  });

  afterEach(() => {
    restoreEnv();
    jest.clearAllMocks();
  });

  test('uses KafkaJS v2 default partitioner explicitly', async () => {
    const { kafkaClient } = await publishWithMocks();

    expect(kafkaClient.producer).toHaveBeenCalledWith({
      createPartitioner: Partitioners.DefaultPartitioner,
    });
  });

  test('builds reconciliation snapshot messages from environment', () => {
    process.env.PROGRAM_ID = 'program-1';
    process.env.MESSAGE_ID = 'treasury-recon-1';
    process.env.OCCURRED_AT = '2026-07-02T14:00:00.000Z';
    process.env.TOTAL_LIMIT = '10000000';
    process.env.RESERVED_AMOUNT = '0';
    process.env.CURRENCY = 'USD';

    expect(buildProgramReconciledMessage()).toEqual({
      messageId: 'treasury-recon-1',
      schemaVersion: 1,
      eventType: 'PROGRAM_RECONCILED',
      occurredAt: '2026-07-02T14:00:00.000Z',
      programId: 'program-1',
      currency: 'USD',
      totalLimit: 10000000,
      reservedAmount: 0,
    });
  });

  test('rejects negative reconciliation reserved amounts', () => {
    process.env.PROGRAM_ID = 'program-1';
    process.env.TOTAL_LIMIT = '10000000';
    process.env.RESERVED_AMOUNT = '-1';
    process.env.CURRENCY = 'USD';

    expect(() => buildProgramReconciledMessage())
      .toThrow('RESERVED_AMOUNT must be a non-negative number.');
  });

  test('publishes to an existing topic without creating it', async () => {
    const { result, admin, producer } = await publishWithMocks({
      admin: createMockAdmin({ existingTopics: [TOPIC] }),
    });

    expect(admin.connect).toHaveBeenCalledTimes(1);
    expect(admin.listTopics).toHaveBeenCalledTimes(1);
    expect(admin.createTopics).not.toHaveBeenCalled();
    expect(admin.fetchTopicMetadata).toHaveBeenCalledWith({
      topics: [TOPIC],
    });
    expect(producer.send).toHaveBeenCalledWith({
      topic: TOPIC,
      messages: [{
        key: PAYLOAD.programId,
        value: JSON.stringify(PAYLOAD),
      }],
    });
    expect(result).toEqual({
      topic: TOPIC,
      key: PAYLOAD.programId,
      payload: PAYLOAD,
    });
  });

  test('creates a missing topic and confirms metadata before publishing', async () => {
    const admin = createMockAdmin({ existingTopics: [] });
    const producer = createMockProducer();

    await publishWithMocks({ admin, producer });

    expect(admin.createTopics).toHaveBeenCalledWith({
      waitForLeaders: true,
      topics: [{
        topic: TOPIC,
        numPartitions: TOPIC_CONFIG.numPartitions,
        replicationFactor: TOPIC_CONFIG.replicationFactor,
      }],
    });
    expect(admin.listTopics.mock.invocationCallOrder[0])
      .toBeLessThan(admin.createTopics.mock.invocationCallOrder[0]);
    expect(admin.createTopics.mock.invocationCallOrder[0])
      .toBeLessThan(admin.fetchTopicMetadata.mock.invocationCallOrder[0]);
    expect(admin.fetchTopicMetadata.mock.invocationCallOrder[0])
      .toBeLessThan(producer.connect.mock.invocationCallOrder[0]);
    expect(producer.send).toHaveBeenCalledTimes(1);
  });

  test('propagates real topic creation failures without publishing', async () => {
    const admin = createMockAdmin({
      existingTopics: [],
      createTopicsError: new Error('Topic authorization failed'),
    });
    const producer = createMockProducer();
    const kafkaClient = createMockKafkaClient({ admin, producer });
    const kafkaClientFactory = jest.fn().mockReturnValue(kafkaClient);

    await expect(publishTreasuryMessage(PAYLOAD, {
      kafkaClientFactory,
      kafkaLogPolicyFactory: createKafkaLogPolicy,
      logger: createMockLogger(),
      prepareTopic: prepareTreasuryTopic,
      readiness: READINESS,
      topicConfig: TOPIC_CONFIG,
    })).rejects.toThrow(`[kafka] Topic readiness check for ${TOPIC} failed after 1 attempt(s)`);

    expect(admin.createTopics).toHaveBeenCalledTimes(1);
    expect(admin.fetchTopicMetadata).not.toHaveBeenCalled();
    expect(producer.connect).not.toHaveBeenCalled();
    expect(producer.send).not.toHaveBeenCalled();
    expect(producer.disconnect).not.toHaveBeenCalled();
  });

  test('does not log warnings or errors on the normal publish path', async () => {
    const logger = createMockLogger();

    await publishWithMocks({
      admin: createMockAdmin({ existingTopics: [TOPIC] }),
      logger,
    });

    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });
});
