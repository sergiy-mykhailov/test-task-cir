import Hapi from '@hapi/hapi';
import { jest } from '@jest/globals';
import kafka from './kafka.js';
import shutdown from './shutdown.js';
import { TreasuryKafkaHandlerResult } from '../services/treasury-kafka-message-handler.js';

const ENABLED_CONFIG = {
  enabled: true,
  brokers: ['localhost:9092'],
  clientId: 'cir-service-test',
  consumerGroupId: 'cir-service-treasury-test',
  treasuryEventsTopic: 'treasury.capacity.events',
  fromBeginning: false,
};

const createMockConsumer = () => ({
  connect: jest.fn().mockResolvedValue(undefined),
  subscribe: jest.fn().mockResolvedValue(undefined),
  run: jest.fn().mockResolvedValue(undefined),
  disconnect: jest.fn().mockResolvedValue(undefined),
});

const createMockAdmin = () => ({
  disconnect: jest.fn().mockResolvedValue(undefined),
});

const createMockKafkaLogPolicy = () => ({
  logCreator: jest.fn(),
  markStartupComplete: jest.fn(),
});

describe('kafka plugin', () => {
  test('does not create a Kafka client when Kafka is disabled', async () => {
    const server = Hapi.server();
    const kafkaClientFactory = jest.fn();
    const kafkaLogPolicyFactory = jest.fn();
    const prepareTopic = jest.fn();

    await server.register({
      plugin: kafka,
      options: {
        config: {
          ...ENABLED_CONFIG,
          enabled: false,
        },
        kafkaClientFactory,
        kafkaLogPolicyFactory,
        prepareTopic,
      },
    });

    expect(kafkaClientFactory).not.toHaveBeenCalled();
    expect(kafkaLogPolicyFactory).not.toHaveBeenCalled();
    expect(prepareTopic).not.toHaveBeenCalled();
  });

  test('connects, subscribes, dispatches messages, and disconnects on shutdown', async () => {
    const server = Hapi.server({ port: 0 });
    const admin = createMockAdmin();
    const consumer = createMockConsumer();
    const kafkaClient = {
      admin: jest.fn().mockReturnValue(admin),
      consumer: jest.fn().mockReturnValue(consumer),
    };
    const kafkaClientFactory = jest.fn().mockReturnValue(kafkaClient);
    const kafkaLogPolicy = createMockKafkaLogPolicy();
    const kafkaLogPolicyFactory = jest.fn().mockReturnValue(kafkaLogPolicy);
    const prepareTopic = jest.fn().mockResolvedValue(undefined);
    const handler = {
      handleKafkaMessage: jest.fn().mockResolvedValue({
        status: TreasuryKafkaHandlerResult.Processed,
        message: { id: 1 },
      }),
    };
    const kafkaPayload = {
      topic: ENABLED_CONFIG.treasuryEventsTopic,
      partition: 0,
      message: {
        offset: '1',
        key: Buffer.from('program-1'),
        value: Buffer.from('{}'),
      },
    };

    await server.register({
      plugin: kafka,
      options: {
        config: ENABLED_CONFIG,
        kafkaClientFactory,
        kafkaLogPolicyFactory,
        prepareTopic,
        handler,
      },
    });
    await server.register(shutdown);

    expect(kafkaLogPolicyFactory).toHaveBeenCalledWith(server.logger);
    expect(kafkaClientFactory).toHaveBeenCalledWith({
      clientId: ENABLED_CONFIG.clientId,
      brokers: ENABLED_CONFIG.brokers,
      logCreator: kafkaLogPolicy.logCreator,
    });
    expect(kafkaClient.admin).toHaveBeenCalledTimes(1);
    expect(prepareTopic).toHaveBeenCalledWith({
      admin,
      config: ENABLED_CONFIG,
      readiness: {
        attempts: 20,
        delayMs: 1000,
      },
      topicConfig: {
        numPartitions: 1,
        replicationFactor: 1,
      },
      logger: server.logger,
    });
    expect(kafkaClient.consumer).toHaveBeenCalledWith({
      groupId: ENABLED_CONFIG.consumerGroupId,
    });
    expect(consumer.connect).toHaveBeenCalledTimes(1);
    expect(consumer.subscribe).toHaveBeenCalledWith({
      topic: ENABLED_CONFIG.treasuryEventsTopic,
      fromBeginning: ENABLED_CONFIG.fromBeginning,
    });
    expect(consumer.run).toHaveBeenCalledTimes(1);
    expect(consumer.run.mock.invocationCallOrder[0])
      .toBeLessThan(kafkaLogPolicy.markStartupComplete.mock.invocationCallOrder[0]);

    const { eachMessage } = consumer.run.mock.calls[0][0];

    await eachMessage(kafkaPayload);

    expect(handler.handleKafkaMessage).toHaveBeenCalledWith(kafkaPayload);

    await server.stop();

    expect(consumer.disconnect).toHaveBeenCalledTimes(1);
  });

  test('fails startup when Kafka is enabled without brokers', async () => {
    const server = Hapi.server();

    await expect(server.register({
      plugin: kafka,
      options: {
        config: {
          ...ENABLED_CONFIG,
          brokers: [],
        },
        kafkaClientFactory: jest.fn(),
        kafkaLogPolicyFactory: jest.fn(),
        prepareTopic: jest.fn(),
      },
    })).rejects.toThrow('KAFKA_BROKERS');
  });
});
