import { timeout } from '../utils/common.js';

export const DEFAULT_READINESS = Object.freeze({
  attempts: 20,
  delayMs: 1000,
});

export const DEFAULT_TOPIC_CONFIG = Object.freeze({
  numPartitions: 1,
  replicationFactor: 1,
});

const createTopicOptions = ({ topic, topicConfig }) => ({
  waitForLeaders: true,
  topics: [{
    topic,
    numPartitions: topicConfig.numPartitions,
    replicationFactor: topicConfig.replicationFactor,
  }],
});

const getErrorMessage = (error) =>
  error instanceof Error ? error.message : String(error);

export const withKafkaStartupRetry = async ({
  operation,
  operationName,
  brokers,
  readiness,
  logger,
}) => {
  let lastError;

  for (let attempt = 1; attempt <= readiness.attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      logger?.warn?.({
        attempt,
        attempts: readiness.attempts,
        error: getErrorMessage(error),
      }, `[kafka] ${operationName} attempt failed`);

      if (attempt < readiness.attempts && readiness.delayMs > 0) {
        await timeout(readiness.delayMs);
      }
    }
  }

  throw new Error(
    `[kafka] ${operationName} failed after ${readiness.attempts} attempt(s) for brokers ${brokers.join(', ')}. `
    + `Check cir-kafka health and listener configuration. Last error: ${getErrorMessage(lastError)}`,
  );
};

const ensureTopic = async ({
  admin,
  topic,
  topicConfig,
  topicCreationState,
}) => {
  const existingTopics = await admin.listTopics();

  if (!existingTopics.includes(topic) && !topicCreationState.created) {
    await admin.createTopics(createTopicOptions({
      topic,
      topicConfig,
    }));
    topicCreationState.created = true;
  }

  await admin.fetchTopicMetadata({
    topics: [topic],
  });
};

/*
 * This module owns the admin-client readiness boundary before the consumer is
 * started. It verifies broker connectivity, ensures the local treasury topic
 * exists idempotently, and confirms topic metadata before subscription. Topic
 * creation can succeed before metadata is visible on a fresh single-node broker,
 * so the retry loop may wait for metadata catch-up without issuing another
 * create request after one create has already succeeded.
 *
 * This does not prove that the Kafka consumer-group coordinator is ready. Group
 * coordinator discovery happens later in KafkaJS consumer startup and can still
 * surface the retriable GROUP_COORDINATOR_NOT_AVAILABLE startup race. That
 * narrower consumer-group condition is handled by app/kafka/log-policy.js, while
 * broker connectivity, topic creation, metadata failures, and unrelated Kafka
 * errors still surface as actionable startup failures.
 */
export const prepareTreasuryTopic = async ({
  admin,
  config,
  readiness,
  topicConfig,
  logger,
}) => {
  let connected = false;
  const topicCreationState = {
    created: false,
  };

  try {
    await withKafkaStartupRetry({
      operationName: 'Broker readiness check',
      brokers: config.brokers,
      readiness,
      logger,
      operation: async () => {
        await admin.connect();
        connected = true;
      },
    });

    await withKafkaStartupRetry({
      operationName: `Topic readiness check for ${config.treasuryEventsTopic}`,
      brokers: config.brokers,
      readiness,
      logger,
      operation: async () => ensureTopic({
        admin,
        topic: config.treasuryEventsTopic,
        topicConfig,
        topicCreationState,
      }),
    });
  } finally {
    if (connected) {
      await admin.disconnect();
    }
  }
};
