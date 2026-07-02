import { logLevel } from 'kafkajs';
import { jest } from '@jest/globals';
import { createKafkaLogPolicy } from './log-policy.js';

const GROUP_ID = 'cir-service-treasury-test';

const createMockLogger = () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
});

const emitLog = (logCreator, entry) => {
  const log = logCreator(logLevel.ERROR);

  log({
    namespace: 'Consumer',
    level: logLevel.ERROR,
    label: 'ERROR',
    ...entry,
  });
};

describe('Kafka log policy', () => {
  test('downgrades retriable group coordinator logs only during startup', () => {
    const logger = createMockLogger();
    const policy = createKafkaLogPolicy(logger);

    emitLog(policy.logCreator, {
      log: {
        message: 'Crash: KafkaJSProtocolError: The group coordinator is not available',
        groupId: GROUP_ID,
        stack: 'KafkaJSProtocolError: The group coordinator is not available',
      },
    });
    emitLog(policy.logCreator, {
      log: {
        message: 'Restarting the consumer in 300ms',
        groupId: GROUP_ID,
        retryCount: 0,
        retryTime: 300,
      },
    });

    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn.mock.calls[0][1])
      .toBe('[kafka:Consumer] Crash: KafkaJSProtocolError: The group coordinator is not available');
    expect(logger.warn.mock.calls[1][1])
      .toBe('[kafka:Consumer] Restarting the consumer in 300ms');
  });

  test('preserves group coordinator errors after startup as error logs', () => {
    const logger = createMockLogger();
    const policy = createKafkaLogPolicy(logger);

    policy.markStartupComplete();
    emitLog(policy.logCreator, {
      log: {
        message: 'Crash: KafkaJSProtocolError: The group coordinator is not available',
        groupId: GROUP_ID,
        stack: 'KafkaJSProtocolError: The group coordinator is not available',
      },
    });

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error.mock.calls[0][1])
      .toBe('[kafka:Consumer] Crash: KafkaJSProtocolError: The group coordinator is not available');
  });

  test('clears pending startup restart downgrades when startup completes', () => {
    const logger = createMockLogger();
    const policy = createKafkaLogPolicy(logger);

    emitLog(policy.logCreator, {
      log: {
        message: 'Crash: KafkaJSProtocolError: The group coordinator is not available',
        groupId: GROUP_ID,
      },
    });
    policy.markStartupComplete();
    emitLog(policy.logCreator, {
      log: {
        message: 'Restarting the consumer in 300ms',
        groupId: GROUP_ID,
        retryCount: 1,
        retryTime: 300,
      },
    });

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error.mock.calls[0][1])
      .toBe('[kafka:Consumer] Restarting the consumer in 300ms');
  });

  test('preserves ordinary KafkaJS errors as error logs', () => {
    const logger = createMockLogger();
    const policy = createKafkaLogPolicy(logger);

    emitLog(policy.logCreator, {
      log: {
        message: 'Crash: KafkaJSConnectionError: Connection error',
        groupId: GROUP_ID,
      },
    });

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error.mock.calls[0][1])
      .toBe('[kafka:Consumer] Crash: KafkaJSConnectionError: Connection error');
  });
});
