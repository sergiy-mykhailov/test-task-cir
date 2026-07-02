import { logLevel } from 'kafkajs';

const GROUP_COORDINATOR_NOT_AVAILABLE = 'GROUP_COORDINATOR_NOT_AVAILABLE';
const GROUP_COORDINATOR_NOT_AVAILABLE_MESSAGE = 'The group coordinator is not available';
const UNKNOWN_CONSUMER_GROUP = '__unknown_consumer_group__';

const getLogText = (value) => {
  if (!value) {
    return '';
  }

  if (value instanceof Error) {
    return [
      value.name,
      value.message,
      value.type,
      value.stack,
    ].filter(Boolean).join(' ');
  }

  if (typeof value === 'object') {
    return Object.values(value).map(getLogText).join(' ');
  }

  return String(value);
};

const isGroupCoordinatorStartupRace = (log = {}) => [
  log.message,
  log.type,
  log.error,
  log.stack,
  log.cause,
].some((value) => {
  const text = getLogText(value);

  return text.includes(GROUP_COORDINATOR_NOT_AVAILABLE)
    || text.includes(GROUP_COORDINATOR_NOT_AVAILABLE_MESSAGE);
});

const isConsumerRestartLog = (log = {}) =>
  typeof log.message === 'string' && log.message.startsWith('Restarting the consumer in');

const getConsumerGroupLogKey = (log = {}) => log.groupId || UNKNOWN_CONSUMER_GROUP;

const createKafkaLogPayload = ({ label, log }) => {
  const payload = { ...log };

  delete payload.message;

  return {
    ...payload,
    kafkaLogLevel: label,
  };
};

/*
 * Kafka can report GROUP_COORDINATOR_NOT_AVAILABLE while the broker is still
 * electing or exposing the consumer-group coordinator during initial startup.
 * Apache Kafka documents this as a retriable protocol error:
 * https://kafka.apache.org/43/design/protocol/#error_codes
 *
 * KafkaJS consumer groups discover that coordinator as part of the normal
 * consume flow and retry when it is temporarily unavailable:
 * https://kafka.js.org/docs/consuming
 *
 * The service lowers only this exact startup race while startupActive=true.
 * KafkaJS also logs a paired "Restarting the consumer in ..." ERROR after the
 * coordinator miss, so that paired restart is lowered only when the same group
 * first recorded the startup coordinator race. After startup completes, the
 * same coordinator condition and every unrelated KafkaJS ERROR remain
 * error-level/actionable. They must not be hidden by this policy.
 */

const getKafkaLogMethod = ({
  level,
  log,
  pendingCoordinatorRestarts,
  startupActive,
}) => {
  if (level === logLevel.ERROR && startupActive && isGroupCoordinatorStartupRace(log)) {
    pendingCoordinatorRestarts.add(getConsumerGroupLogKey(log));

    return 'warn';
  }

  if (level === logLevel.ERROR && startupActive && isConsumerRestartLog(log)) {
    const groupKey = getConsumerGroupLogKey(log);

    if (pendingCoordinatorRestarts.has(groupKey)) {
      pendingCoordinatorRestarts.delete(groupKey);

      return 'warn';
    }
  }

  if (level === logLevel.ERROR) {
    return 'error';
  }

  if (level === logLevel.WARN) {
    return 'warn';
  }

  if (level === logLevel.DEBUG) {
    return 'debug';
  }

  return 'info';
};

export const createKafkaLogPolicy = (logger) => {
  const pendingCoordinatorRestarts = new Set();
  let startupActive = true;

  const logCreator = () => ({ namespace, level, label, log }) => {
    const method = getKafkaLogMethod({
      level,
      log,
      pendingCoordinatorRestarts,
      startupActive,
    });
    const messagePrefix = namespace ? `[kafka:${namespace}]` : '[kafka]';
    const message = log?.message ? `${messagePrefix} ${log.message}` : messagePrefix;
    const payload = createKafkaLogPayload({ label, log: log || {} });
    const logMethod = logger?.[method] || logger?.info;

    logMethod?.call(logger, payload, message);
  };

  const markStartupComplete = () => {
    startupActive = false;
    pendingCoordinatorRestarts.clear();
  };

  return {
    logCreator,
    markStartupComplete,
  };
};
