# Kafka Bulk Reconciliation

This document defines the contract for periodic treasury bulk reconciliation snapshots.

Incremental reservation and repayment messages are defined in [`kafka-treasury-ingestion.md`](./kafka-treasury-ingestion.md).

Monetary message fields and reconciliation comparisons follow [`monetary-precision.md`](./monetary-precision.md).

## Scope

The existing `treasury.capacity.events` Kafka topic includes a full-state reconciliation message for one financing program.

The reconciliation message updates the local capacity balance projection for a program. It does not create, update, release, or delete rows in `reservations`.

## Assumptions

- Treasury reconciliation snapshots are authoritative for `program_capacity_balances`.
- Local `reservations` rows remain the service's business history for reservation and release events already processed by the service.
- A mismatch between snapshot `reservedAmount` and the sum of active local reservations is allowed. The snapshot wins for the balance projection.
- Reconciliation uses Kafka partition ordering through the existing `programId` message key. It does not use sequence numbers or reject older `occurredAt` values.
- Programs must already exist locally. Reconciliation snapshots do not auto-create programs.

## Topic Contract

Topic: `treasury.capacity.events`.

Message key: `programId`.

Message value is JSON with `schemaVersion = 2`.

### Program Reconciled

```json
{
  "messageId": "treasury-recon-1",
  "schemaVersion": 2,
  "eventType": "PROGRAM_RECONCILED",
  "occurredAt": "2026-07-02T14:00:00.000Z",
  "programId": "p-1",
  "currency": "USD",
  "totalLimit": "10000000",
  "reservedAmount": "1250000"
}
```

Rules:

- `messageId` is required and must be globally unique from the treasury system.
- `programId` maps to `programs.external_id`.
- `currency` must match the existing program currency.
- `totalLimit` must be a positive decimal string.
- `reservedAmount` must be a non-negative decimal string.
- `reservedAmount` must not exceed `totalLimit`.
- `occurredAt` is the treasury snapshot timestamp used for the balance update and audit event.

Unknown programs, currency mismatches, invalid amounts, malformed JSON, and schema-invalid messages are rejected through the existing Kafka message rejection path and must not mutate capacity.

## State Update Policy

Process `PROGRAM_RECONCILED` in a database transaction:

1. Insert or detect the existing `treasury_kafka_messages` inbox row using the existing `messageId` and `(topic, partition, message_offset)` idempotency rules.
2. Resolve the program by `programs.external_id`.
3. Lock the matching `program_capacity_balances` row for update.
4. Validate snapshot currency and amounts.
5. Overwrite `program_capacity_balances.total_limit` with `totalLimit`.
6. Overwrite `program_capacity_balances.reserved_amount` with `reservedAmount`.
7. Set `program_capacity_balances.updated_at` from `occurredAt`.
8. Insert a `capacity_events` row with `event_type = RECONCILIATION_APPLIED` and `source = RECONCILIATION`.
9. Mark the inbox row as `PROCESSED`.
10. Commit the transaction, then allow the Kafka offset to commit.

`reservations` are intentionally left unchanged. Reconciliation is a balance projection correction, not reservation history reconstruction.

## Capacity Event Contract

`RECONCILIATION_APPLIED` is part of `capacity_event_types`.

For `RECONCILIATION_APPLIED`:

- `program_id` references the reconciled program.
- `reservation_id` is `null`.
- `invoice_id` is `null`.
- `source` is `RECONCILIATION`.
- `amount` stores the final reconciled `reservedAmount` in the program currency.
- `currency` is the program currency.
- `occurred_at` is the snapshot `occurredAt`.

Because a reconciled program may have `reservedAmount = 0`, `capacity_events.amount` must support zero for `RECONCILIATION_APPLIED`. Existing reservation and release events still use positive amounts.

## Idempotency And Rejection

Reuse the existing `treasury_kafka_messages` Kafka inbox.

Duplicate `messageId` or duplicate `(topic, partition, message_offset)` must not apply the reconciliation again and must not create duplicate `capacity_events`.

Malformed or invalid reconciliation messages should create one `REJECTED` inbox record when possible and should not create a `capacity_events` row.

Retryable infrastructure failures should throw so the Kafka offset is not committed.

## Producer Script

A host-side producer script sends reconciliation messages for local operation:

- `tools/produce-reconciliation-message.js` sends `PROGRAM_RECONCILED`.

It is exposed through an npm script, for example `npm run kafka:produce:reconciliation`.

Example command shape:

```shell
PROGRAM_ID=p-1 TOTAL_LIMIT=10000000 RESERVED_AMOUNT=1250000 CURRENCY=USD MESSAGE_ID=msg-recon-1 npm run kafka:produce:reconciliation
```

The script should reuse the same producer, topic-readiness, partitioner, and clean-output behavior as the reservation and release producer scripts.
