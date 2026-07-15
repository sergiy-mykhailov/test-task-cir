# Project Overview

Program Capacity & Invoice Reservation is a backend service for tracking financing program credit capacity in real time. It reserves capacity when invoices are approved for early payment, releases capacity when invoices are repaid, exposes current availability to authenticated clients, and consumes incremental treasury capacity events plus reconciliation snapshots from Kafka.

## Product Source Documents

- [`docs/original-requirements.md`](./original-requirements.md) - source requirements for capacity reservation, release, authenticated endpoints, Kafka treasury flow, reconciliation, currency handling, local run expectations, and documented assumptions.

## Architecture Documents

- [`docs/architecture/capacity-core.md`](./architecture/capacity-core.md) - core capacity tables, reservation and release endpoint contracts, and domain assumptions.
- [`docs/architecture/capacity-safety.md`](./architecture/capacity-safety.md) - transaction, duplicate operation, and concurrency behavior for the capacity flow.
- [`docs/architecture/capacity-currency.md`](./architecture/capacity-currency.md) - local FX rates and cross-currency reservation conversion behavior.
- [`docs/architecture/monetary-precision.md`](./architecture/monetary-precision.md) - exact decimal representation, arithmetic, rounding, API values, and Kafka monetary-field contracts.
- [`docs/architecture/api-authentication.md`](./architecture/api-authentication.md) - service-to-service API token authentication and the unauthenticated health-check exception.
- [`docs/architecture/kafka-treasury-ingestion.md`](./architecture/kafka-treasury-ingestion.md) - Kafka treasury event ingestion contract, including local broker setup, message schema, idempotency, and producer scripts.
- [`docs/architecture/kafka-bulk-reconciliation.md`](./architecture/kafka-bulk-reconciliation.md) - Kafka bulk reconciliation snapshot contract for updating capacity balance projections without rewriting reservation history.

## Implemented Foundation

- Local backend foundation covers the Hapi service structure, Docker/Postgres/Kafka runtime, database connection and migration command flow, health route structure, and local startup documentation.
- Local run guidance lives in [`README.md`](../README.md), including Docker/Postgres/Kafka startup, migrations, authenticated API requests, Kafka producer commands, assumptions, and trade-offs.

## Core Capacity Flow

- Core capacity implementation defines program capacity tables, program creation with initial balance, reservation persistence, release persistence, capacity event audit records, and synchronous capacity/reservation/release API endpoints. See [`docs/architecture/capacity-core.md`](./architecture/capacity-core.md) for the table and endpoint contracts.
- Capacity safety adds row-level transaction boundaries, duplicate reservation/release conflict behavior, concurrent over-reservation protection, and rollback guarantees. See [`docs/architecture/capacity-safety.md`](./architecture/capacity-safety.md).

## Currency Handling

- Currency handling stores locally managed FX rates, accepts invoice currencies that differ from program currencies, converts reservation amounts into program currency at reservation time, and releases the stored converted amount without re-conversion. See [`docs/architecture/capacity-currency.md`](./architecture/capacity-currency.md).

## API Authentication

- API authentication uses a custom Hapi Bearer token scheme for service-to-service API calls. Program, FX rate, capacity, reservation, and release routes require `Authorization: Bearer <API_TOKEN>`, while `GET /health` remains unauthenticated for liveness/readiness checks. See [`docs/architecture/api-authentication.md`](./architecture/api-authentication.md).

## Kafka Treasury Ingestion

- Kafka treasury ingestion runs a local `cir-kafka` broker, consumes `treasury.capacity.events` when enabled, stores processed or rejected messages in `treasury_kafka_messages`, and applies reservation approval and invoice repayment messages through the existing capacity domain with `source = KAFKA_TREASURY`. See [`docs/architecture/kafka-treasury-ingestion.md`](./architecture/kafka-treasury-ingestion.md).
- Bulk reconciliation uses a `PROGRAM_RECONCILED` message in the same Kafka topic. It updates `program_capacity_balances`, leaves `reservations` unchanged, and records a `RECONCILIATION_APPLIED` capacity event. See [`docs/architecture/kafka-bulk-reconciliation.md`](./architecture/kafka-bulk-reconciliation.md).
- Terminal Boom `4xx` capacity-domain failures from supported treasury Kafka events are recorded as `REJECTED` inbox messages without mutating capacity state or retrying forever; non-Boom and Boom `5xx` failures still throw for redelivery. See [`docs/architecture/kafka-treasury-ingestion.md`](./architecture/kafka-treasury-ingestion.md).
