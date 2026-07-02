# Kafka Treasury Ingestion

This document defines the contract for consuming capacity events from the external treasury system through Kafka.

Bulk reconciliation snapshots use the same Kafka topic and are defined separately in [`kafka-bulk-reconciliation.md`](./kafka-bulk-reconciliation.md).

## Integration Boundaries

Kafka treasury ingestion covers:

- a real single-node Kafka broker in local `docker-compose.yaml`;
- a service-side Kafka consumer registered as a Hapi plugin;
- incremental treasury message validation and dispatch;
- idempotent message processing;
- local producer scripts for manual operation.

Kafka treasury ingestion does not cover:

- Kafka SASL, TLS, ACLs, or managed broker deployment;
- a dead-letter topic;
- cross-service distributed transactions.

## Local Kafka Runtime

Local development should use a real Kafka broker, not an emulator.

Use a pinned single-node Apache Kafka broker image, `apache/kafka:4.3.1` as of 2026-07-02, in KRaft combined mode in `docker-compose.yaml`. The broker should expose one listener for Docker-network clients and one listener for host-side scripts:

- internal service listener: `cir-kafka:19092`;
- host listener: `localhost:9092`;
- controller listener: internal only.

`cir-service` should depend on `cir-kafka` in Compose. The service should connect to Kafka through the Docker-network listener. Host-side producer scripts should connect through the host listener.

For deterministic local startup, `cir-kafka` should expose a health check and `cir-service` should wait for the broker health condition in Compose. The service Kafka plugin should still perform its own bounded readiness check because Compose startup ordering does not prove topic metadata is immediately available to the client.

## Service Configuration

Kafka configuration uses the existing environment configuration boundary.

- `KAFKA_ENABLED` - `true` starts the consumer; `false` skips all Kafka startup work.
- `KAFKA_BROKERS` - comma-separated broker list.
- `KAFKA_CLIENT_ID` - Kafka client id, defaulting to `cir-service` in local examples.
- `KAFKA_CONSUMER_GROUP_ID` - consumer group id, defaulting to `cir-service-treasury` in local examples.
- `KAFKA_TREASURY_EVENTS_TOPIC` - incremental treasury events topic, defaulting to `treasury.capacity.events` in local examples.
- `KAFKA_FROM_BEGINNING` - optional local flag for first-run replay behavior; default should be `false`.

`.env` should use Docker-network brokers, for example `KAFKA_BROKERS=cir-kafka:19092`. `.env.local` may use `KAFKA_BROKERS=localhost:9092` for host-side producer scripts.

## Client Library

Use pinned `kafkajs` `2.2.4` as the service Kafka client.

The service uses a real Kafka protocol client for consumer groups, producer scripts, topic subscription, and local operation. Local development uses the Compose Kafka broker.

KafkaJS v2 producer scripts must configure `Partitioners.DefaultPartitioner` explicitly. New producer code does not need KafkaJS v1 partition compatibility, and the explicit v2 default avoids partitioner migration warnings while preserving `programId` key partitioning for per-program ordering.

## Hapi Plugin Contract

A dedicated Kafka plugin, for example `app/plugins/kafka.js`, owns Kafka consumer startup and subscription.

The plugin should:

- skip startup when `KAFKA_ENABLED=false`;
- create a KafkaJS client and consumer from environment configuration;
- verify broker readiness with bounded retries before starting the consumer;
- create or confirm the local `KAFKA_TREASURY_EVENTS_TOPIC` topic and fetch its metadata before subscribing; existing topics should be detected before attempting creation so normal restarts do not emit topic-already-exists errors;
- subscribe to `KAFKA_TREASURY_EVENTS_TOPIC`;
- run the incremental treasury message handler for each consumed message;
- log startup, shutdown, duplicate-message skips, and rejected malformed messages without logging secrets;
- route KafkaJS client logs through the service logger; expected retriable consumer-group coordinator-not-ready races may be logged below error level only during initial consumer startup, while the same condition after startup and other KafkaJS errors remain error-level and actionable;
- disconnect the consumer during Hapi server shutdown.

`GROUP_COORDINATOR_NOT_AVAILABLE` is a Kafka protocol error that can occur while a consumer group coordinator is still becoming available during initial startup. KafkaJS consumer groups rely on broker group coordination, so this startup race may be lowered below error only until the consumer has started; after startup, the same condition should be treated as an actionable error. References: [Kafka protocol error codes](https://kafka.apache.org/protocol.html#protocol_error_codes) and [KafkaJS consuming / consumer groups](https://kafka.js.org/docs/consuming).

Kafka ingestion should call the same capacity domain operations as the API path. The capacity service should accept a source option so API operations continue writing `source = API`, while Kafka operations write `source = KAFKA_TREASURY`.

## Topic Contract

Topic: `treasury.capacity.events`.

Message key: `programId`.

Using `programId` as the key keeps messages for the same financing program in one Kafka partition, preserving order for that program while still allowing different programs to be processed independently when the topic has multiple partitions.

Message value is JSON with `schemaVersion = 1`.

### Reservation Approved

```json
{
  "messageId": "treasury-msg-1",
  "schemaVersion": 1,
  "eventType": "RESERVATION_APPROVED",
  "occurredAt": "2026-07-02T12:00:00.000Z",
  "programId": "p-1",
  "invoiceId": "i-1",
  "amount": 1000,
  "currency": "EUR"
}
```

Rules:

- `messageId` is required and must be globally unique from the treasury system.
- `programId` maps to `programs.external_id`.
- `invoiceId` maps to `reservations.invoice_id`.
- `amount` and `currency` are the invoice amount and invoice currency.
- The handler must create a reservation using existing currency conversion behavior.
- The resulting `capacity_events` row uses `event_type = RESERVATION_CREATED` and `source = KAFKA_TREASURY`.

### Invoice Repaid

```json
{
  "messageId": "treasury-msg-2",
  "schemaVersion": 1,
  "eventType": "INVOICE_REPAID",
  "occurredAt": "2026-07-02T13:00:00.000Z",
  "programId": "p-1",
  "invoiceId": "i-1"
}
```

Rules:

- `messageId`, `programId`, and `invoiceId` are required.
- The handler must fully release the existing reservation by external `programId` and `invoiceId`.
- Any `amount` or `currency` fields on repayment messages are ignored; repayment fully releases the stored reservation amount.
- The resulting `capacity_events` row uses `event_type = RESERVATION_RELEASED` and `source = KAFKA_TREASURY`.

## Message Idempotency

Kafka delivery must be treated as at-least-once.

Use a dedicated transport-level inbox table for Kafka message idempotency. Do not use `capacity_events` as the only idempotency store.

Table: `treasury_kafka_messages`.

- `id` - primary key.
- `message_id` - external treasury message id, unique when present.
- `topic` - consumed Kafka topic.
- `partition` - consumed Kafka partition.
- `message_offset` - consumed Kafka offset stored as a string.
- `message_key` - consumed Kafka key, nullable.
- `schema_version` - parsed message schema version, nullable for malformed messages.
- `event_type` - parsed treasury event type, nullable for malformed messages.
- `program_id` - external program id from the payload, nullable for malformed messages.
- `invoice_id` - external invoice id from the payload, nullable.
- `status` - `PROCESSED` or `REJECTED`.
- `failure_reason` - nullable short rejection reason.
- `processed_at`, `created_at`.

Use a unique constraint on `message_id` for valid treasury messages and a unique constraint on `(topic, partition, message_offset)` for broker-level duplicate delivery.

Why this is separate from `capacity_events`:

- `capacity_events` is a domain audit trail, not a Kafka inbox.
- malformed messages may need to be recorded and skipped without producing a capacity event;
- reconciliation messages can produce zero or one domain events depending on validation outcome;
- transport metadata such as topic, partition, and offset should not be required on every domain event;
- duplicate Kafka delivery can be identified before attempting the domain mutation.

## Processing Semantics

For a valid message:

1. Parse and validate the JSON payload.
2. Start a database transaction.
3. Insert the `treasury_kafka_messages` row.
4. If `message_id` or `(topic, partition, message_offset)` is already present, treat the message as already handled and do not mutate capacity again.
5. Apply the matching capacity domain operation with `source = KAFKA_TREASURY`.
6. Commit the transaction.
7. Allow KafkaJS to commit the consumed offset only after the handler succeeds.

For malformed JSON or schema-invalid messages:

1. Record a `REJECTED` row in `treasury_kafka_messages` using topic, partition, and offset.
2. Do not create a `capacity_events` row.
3. Allow the offset to commit so the consumer does not loop forever on poison messages.

For domain-level business validation failures raised by the capacity domain as Boom `4xx` errors while processing `RESERVATION_APPROVED`, `INVOICE_REPAID`, or `PROGRAM_RECONCILED`:

1. Treat the Kafka message as a terminal business-invalid treasury message, not as a retryable infrastructure failure.
2. Persist the `treasury_kafka_messages` row as `REJECTED` with a concise `failure_reason`.
3. Do not create a `capacity_events` row and do not mutate program capacity, reservations, or reconciliation state.
4. Return a rejected handler result without throwing so KafkaJS may commit the consumed offset and avoid an infinite retry loop.

For retryable infrastructure errors, the handler should throw so the Kafka offset is not committed and Kafka can redeliver the message.

## Terminal Business-Invalid Messages

Terminal business-invalid Kafka messages are structurally valid treasury messages that cannot be applied because current domain state rejects them with a Boom `4xx` error.

Reservation approval messages are terminal when the capacity domain rejects the reservation because of state or business validation, such as a missing FX rate, duplicate invoice, unknown program, or insufficient capacity. The service records one `treasury_kafka_messages` row with `status = REJECTED`, stores a concise failure reason, creates no `capacity_events` row, creates no reservation, leaves the capacity balance unchanged, and returns a rejected handler result without throwing.

Invoice repayment messages are terminal when the capacity domain rejects the release because the reservation is missing or already released. The service records one `treasury_kafka_messages` row with `status = REJECTED`, stores a concise failure reason, creates no release event, leaves reservation and capacity state unchanged, and returns a rejected handler result without throwing.

Reconciliation messages use the same terminal rejection policy for Boom `4xx` domain failures. Successful reconciliation snapshots still overwrite only `program_capacity_balances`, and duplicate `messageId` or duplicate broker offsets still do not apply state changes twice.

Non-Boom errors and Boom `5xx` errors are retryable. The handler throws, does not mark the message as terminally rejected, and allows Kafka to redeliver the message later.

## Producer Scripts

Host-side producer scripts under `tools/` send supported treasury messages through npm scripts.

- `tools/produce-reservation-message.js` sends `RESERVATION_APPROVED`.
- `tools/produce-release-message.js` sends `INVOICE_REPAID`.

The scripts should read broker and topic configuration from environment variables, default to `localhost:9092` for host usage, use `programId` as the Kafka message key, and configure KafkaJS v2 `Partitioners.DefaultPartitioner` explicitly.

Example command shape:

```shell
PROGRAM_ID=p-1 INVOICE_ID=i-1 AMOUNT=1000 CURRENCY=EUR MESSAGE_ID=msg-1 npm run kafka:produce:reservation
PROGRAM_ID=p-1 INVOICE_ID=i-1 MESSAGE_ID=msg-2 npm run kafka:produce:release
```

The scripts should share the service topic-readiness flow: connect an admin client, list existing topics, create `treasury.capacity.events` only when missing, fetch topic metadata, and fail with an actionable non-zero error when creation or metadata confirmation fails. A successful normal-path publish should not emit KafkaJS partitioner warnings or `CreateTopics` error logs.
