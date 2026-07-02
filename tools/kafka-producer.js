import { randomUUID } from 'node:crypto';
import { Kafka, Partitioners } from 'kafkajs';
import { kafka as kafkaConfig } from '../app/constants/env.js';
import { TreasuryKafkaEventType } from '../app/constants/capacity.js';
import {
  DEFAULT_READINESS,
  DEFAULT_TOPIC_CONFIG,
  prepareTreasuryTopic,
} from '../app/kafka/topic-readiness.js';
import { createKafkaLogPolicy } from '../app/kafka/log-policy.js';

const readRequiredEnv = (name) => {
  const value = process.env[name];

  if (!value || !value.trim()) {
    throw new Error(`${name} is required.`);
  }

  return value.trim();
};

const readOptionalEnv = (name, defaultValue) => {
  const value = process.env[name];

  return value && value.trim() ? value.trim() : defaultValue;
};

const readPositiveAmount = () => {
  const amount = Number(readRequiredEnv('AMOUNT'));

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('AMOUNT must be a positive number.');
  }

  return amount;
};

const readCurrency = () => {
  const currency = readRequiredEnv('CURRENCY');

  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new Error('CURRENCY must be an uppercase three-letter code.');
  }

  return currency;
};

export const getProducerKafkaConfig = () => ({
  brokers: kafkaConfig.brokers.length ? kafkaConfig.brokers : ['localhost:9092'],
  clientId: process.env.KAFKA_CLIENT_ID || 'cir-producer',
  treasuryEventsTopic: kafkaConfig.treasuryEventsTopic,
});

const buildBaseMessage = (eventType) => ({
  messageId: readOptionalEnv('MESSAGE_ID', randomUUID()),
  schemaVersion: 1,
  eventType,
  occurredAt: readOptionalEnv('OCCURRED_AT', new Date().toISOString()),
  programId: readRequiredEnv('PROGRAM_ID'),
  invoiceId: readRequiredEnv('INVOICE_ID'),
});

export const buildReservationApprovedMessage = () => ({
  ...buildBaseMessage(TreasuryKafkaEventType.ReservationApproved),
  amount: readPositiveAmount(),
  currency: readCurrency(),
});

export const buildInvoiceRepaidMessage = () =>
  buildBaseMessage(TreasuryKafkaEventType.InvoiceRepaid);

export const createProducerCliLogger = (consoleObject = console) => ({
  warn(payload, message) {
    consoleObject.warn(message, payload);
  },
  error(payload, message) {
    consoleObject.error(message, payload);
  },
  info() {},
  debug() {},
});

const createKafkaClient = ({ clientId, brokers, logCreator }) =>
  new Kafka({
    clientId,
    brokers,
    logCreator,
  });

export const createTreasuryProducer = (client) =>
  client.producer({
    createPartitioner: Partitioners.DefaultPartitioner,
  });

export const publishTreasuryMessage = async (payload, {
  kafkaClientFactory = createKafkaClient,
  kafkaLogPolicyFactory = createKafkaLogPolicy,
  logger = createProducerCliLogger(),
  prepareTopic = prepareTreasuryTopic,
  readiness = DEFAULT_READINESS,
  topicConfig = DEFAULT_TOPIC_CONFIG,
} = {}) => {
  const config = getProducerKafkaConfig();
  const kafkaLogPolicy = kafkaLogPolicyFactory(logger);
  const client = kafkaClientFactory({
    clientId: config.clientId,
    brokers: config.brokers,
    logCreator: kafkaLogPolicy.logCreator,
  });
  const admin = client.admin();
  const producer = createTreasuryProducer(client);
  let producerConnected = false;

  try {
    await prepareTopic({
      admin,
      config,
      readiness,
      topicConfig,
      logger,
    });

    await producer.connect();
    producerConnected = true;
    await producer.send({
      topic: config.treasuryEventsTopic,
      messages: [{
        key: payload.programId,
        value: JSON.stringify(payload),
      }],
    });

    return {
      topic: config.treasuryEventsTopic,
      key: payload.programId,
      payload,
    };
  } finally {
    kafkaLogPolicy.markStartupComplete();

    if (producerConnected) {
      await producer.disconnect();
    }
  }
};
