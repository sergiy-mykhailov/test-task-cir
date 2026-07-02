import { jest } from '@jest/globals';
import { prepareTreasuryTopic } from './topic-readiness.js';

const CONFIG = {
  brokers: ['localhost:9092'],
  treasuryEventsTopic: 'treasury.capacity.events',
};

const READINESS = {
  attempts: 2,
  delayMs: 0,
};

const TOPIC_CONFIG = {
  numPartitions: 1,
  replicationFactor: 1,
};

const createMockLogger = () => ({
  warn: jest.fn(),
});

const createMockAdmin = () => ({
  connect: jest.fn().mockResolvedValue(undefined),
  listTopics: jest.fn().mockResolvedValue([]),
  createTopics: jest.fn().mockResolvedValue(true),
  fetchTopicMetadata: jest.fn().mockResolvedValue({
    topics: [{ name: CONFIG.treasuryEventsTopic }],
  }),
  disconnect: jest.fn().mockResolvedValue(undefined),
});

const prepareTopic = (admin, logger = createMockLogger()) =>
  prepareTreasuryTopic({
    admin,
    config: CONFIG,
    readiness: READINESS,
    topicConfig: TOPIC_CONFIG,
    logger,
  });

describe('Kafka topic readiness', () => {
  test('creates a missing treasury topic before fetching metadata', async () => {
    const admin = createMockAdmin();

    await prepareTopic(admin);

    expect(admin.connect).toHaveBeenCalledTimes(1);
    expect(admin.listTopics).toHaveBeenCalledTimes(1);
    expect(admin.createTopics).toHaveBeenCalledWith({
      waitForLeaders: true,
      topics: [{
        topic: CONFIG.treasuryEventsTopic,
        numPartitions: TOPIC_CONFIG.numPartitions,
        replicationFactor: TOPIC_CONFIG.replicationFactor,
      }],
    });
    expect(admin.fetchTopicMetadata).toHaveBeenCalledWith({
      topics: [CONFIG.treasuryEventsTopic],
    });
    expect(admin.listTopics.mock.invocationCallOrder[0])
      .toBeLessThan(admin.createTopics.mock.invocationCallOrder[0]);
    expect(admin.createTopics.mock.invocationCallOrder[0])
      .toBeLessThan(admin.fetchTopicMetadata.mock.invocationCallOrder[0]);
    expect(admin.disconnect).toHaveBeenCalledTimes(1);
  });

  test('skips creation when the treasury topic already exists', async () => {
    const admin = createMockAdmin();

    admin.listTopics.mockResolvedValue([CONFIG.treasuryEventsTopic]);

    await prepareTopic(admin);

    expect(admin.listTopics).toHaveBeenCalledTimes(1);
    expect(admin.createTopics).not.toHaveBeenCalled();
    expect(admin.fetchTopicMetadata).toHaveBeenCalledWith({
      topics: [CONFIG.treasuryEventsTopic],
    });
    expect(admin.disconnect).toHaveBeenCalledTimes(1);
  });

  test('retries metadata readiness without recreating an existing topic', async () => {
    const admin = createMockAdmin();

    admin.listTopics
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([CONFIG.treasuryEventsTopic]);
    admin.fetchTopicMetadata
      .mockRejectedValueOnce(new Error('UNKNOWN_TOPIC_OR_PARTITION'))
      .mockResolvedValueOnce({
        topics: [{ name: CONFIG.treasuryEventsTopic }],
      });

    await prepareTopic(admin);

    expect(admin.listTopics).toHaveBeenCalledTimes(2);
    expect(admin.createTopics).toHaveBeenCalledTimes(1);
    expect(admin.fetchTopicMetadata).toHaveBeenCalledTimes(2);
    expect(admin.disconnect).toHaveBeenCalledTimes(1);
  });

  test('does not recreate a successfully requested topic while metadata catches up', async () => {
    const admin = createMockAdmin();

    admin.listTopics.mockResolvedValue([]);
    admin.fetchTopicMetadata
      .mockRejectedValueOnce(new Error('UNKNOWN_TOPIC_OR_PARTITION'))
      .mockResolvedValueOnce({
        topics: [{ name: CONFIG.treasuryEventsTopic }],
      });

    await prepareTopic(admin);

    expect(admin.listTopics).toHaveBeenCalledTimes(2);
    expect(admin.createTopics).toHaveBeenCalledTimes(1);
    expect(admin.fetchTopicMetadata).toHaveBeenCalledTimes(2);
    expect(admin.disconnect).toHaveBeenCalledTimes(1);
  });

  test('fails startup with an actionable error when the broker never becomes ready', async () => {
    const admin = createMockAdmin();

    admin.connect.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(prepareTopic(admin))
      .rejects.toThrow('[kafka] Broker readiness check failed after 2 attempt(s)');

    expect(admin.connect).toHaveBeenCalledTimes(2);
    expect(admin.listTopics).not.toHaveBeenCalled();
    expect(admin.createTopics).not.toHaveBeenCalled();
    expect(admin.disconnect).not.toHaveBeenCalled();
  });

  test('fails startup with an actionable error when topic creation fails', async () => {
    const admin = createMockAdmin();

    admin.createTopics.mockRejectedValue(new Error('Topic authorization failed'));

    await expect(prepareTopic(admin))
      .rejects.toThrow(`[kafka] Topic readiness check for ${CONFIG.treasuryEventsTopic} failed after 2 attempt(s)`);

    expect(admin.listTopics).toHaveBeenCalledTimes(2);
    expect(admin.createTopics).toHaveBeenCalledTimes(2);
    expect(admin.fetchTopicMetadata).not.toHaveBeenCalled();
    expect(admin.disconnect).toHaveBeenCalledTimes(1);
  });
});
