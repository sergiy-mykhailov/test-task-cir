import { Kafka } from 'kafkajs';
import { kafka as kafkaConfig } from '../constants/env.js';
import { createKafkaLogPolicy } from '../kafka/log-policy.js';
import {
  DEFAULT_READINESS,
  DEFAULT_TOPIC_CONFIG,
  prepareTreasuryTopic,
} from '../kafka/topic-readiness.js';
import {
  TreasuryKafkaHandlerResult,
  treasuryKafkaMessageHandler,
} from '../services/treasury-kafka-message-handler.js';

const createKafkaClient = ({ clientId, brokers, logCreator }) =>
  new Kafka({
    clientId,
    brokers,
    logCreator,
  });

const logKafkaResult = (server, result) => {
  if (result.status === TreasuryKafkaHandlerResult.Duplicate) {
    server.logger?.info?.('[kafka] Duplicate treasury message skipped');
  } else if (result.status === TreasuryKafkaHandlerResult.Rejected) {
    server.logger?.warn?.({ reason: result.message.failureReason }, '[kafka] Treasury message rejected');
  }
};

const register = async (server, {
  config = kafkaConfig,
  kafkaClientFactory = createKafkaClient,
  kafkaLogPolicyFactory = createKafkaLogPolicy,
  handler = treasuryKafkaMessageHandler,
  prepareTopic = prepareTreasuryTopic,
  readiness = DEFAULT_READINESS,
  topicConfig = DEFAULT_TOPIC_CONFIG,
} = {}) => {
  if (!config.enabled) {
    server.logger?.info?.('[kafka] Consumer startup skipped because KAFKA_ENABLED=false');

    return;
  }

  if (!config.brokers.length) {
    throw new Error('KAFKA_BROKERS must include at least one broker when KAFKA_ENABLED=true.');
  }

  const kafkaLogPolicy = kafkaLogPolicyFactory(server.logger);
  const kafka = kafkaClientFactory({
    clientId: config.clientId,
    brokers: config.brokers,
    logCreator: kafkaLogPolicy.logCreator,
  });
  const normalizedReadiness = {
    ...DEFAULT_READINESS,
    ...readiness,
  };
  const normalizedTopicConfig = {
    ...DEFAULT_TOPIC_CONFIG,
    ...topicConfig,
  };
  const admin = kafka.admin();
  const consumer = kafka.consumer({ groupId: config.consumerGroupId });

  await prepareTopic({
    admin,
    config,
    readiness: normalizedReadiness,
    topicConfig: normalizedTopicConfig,
    logger: server.logger,
  });

  await consumer.connect();
  await consumer.subscribe({
    topic: config.treasuryEventsTopic,
    fromBeginning: config.fromBeginning,
  });
  await consumer.run({
    eachMessage: async (payload) => {
      const result = await handler.handleKafkaMessage(payload);

      logKafkaResult(server, result);
    },
  });
  kafkaLogPolicy.markStartupComplete();

  server.app.kafkaConsumer = consumer;
  server.logger?.info?.(`[kafka] Subscribed to ${config.treasuryEventsTopic}`);
};

export default {
  name: 'kafka',
  version: '0.0.1',
  register,
};
