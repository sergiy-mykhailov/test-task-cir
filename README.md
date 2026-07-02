# Program Capacity &amp; Invoice Reservation

## Assumptions

- The service may track multiple financing programs, each with its own credit limit and currency.
- Invoice lifecycle is owned by an external system. This service stores an external `invoice_id` on reservations and does not create a separate invoices table for the core reservation flow.
- A repayment fully releases the related reservation. Partial repayments and partial releases are out of scope for the initial implementation.
- Duplicate API operations are handled through external invoice identifiers, reservation status checks, database constraints, and transactions.
- Concurrent reservation and release operations are serialized on the program capacity balance row so accepted reservations cannot exceed the program limit.
- FX rates are managed locally in the service.
- The service is assumed to be consumed by other API services, so authentication uses a simple static API token instead of user sessions, OAuth/OIDC, or JWT issuance.
- `GET /health` is intentionally unauthenticated because clustered deployments commonly use unauthenticated liveness and readiness checks.
- Kafka integration delivers reservation and repayment events from the treasury system through the same capacity domain operations as the API.
- Bulk reconciliation snapshots update `program_capacity_balances` only. Existing `reservations` are not rebuilt or modified from snapshots.
- Structurally valid Kafka messages that fail with terminal capacity-domain `4xx` errors are recorded as rejected inbox messages and skipped; retryable non-Boom and `5xx` failures still throw so Kafka can redeliver them.

## Installation

- Install Docker.

- Install Node.js.

- Install npm dependencies.
```shell
npm ci
```

- Copy environment examples.
```shell
cp .env.example .env
cp .env.local.example .env.local
cp .env.test.example .env.test
```

- Set `API_TOKEN` in `.env`.

- Start all services.
```shell
docker-compose up -d
```

- Create a database (for the first run only)
```shell
npm run db:create
```

- Apply database migrations.
```shell
npm run db:migrate:all
```

## Additional commands

Run unit tests.
```shell
npm run test:unit
```

Run DB-backed integration tests (these tests require `.env.test`).
```shell
npm run test:integration
```

Produce a local treasury reservation message through Kafka.
```shell
PROGRAM_ID=p-1 INVOICE_ID=i-4 AMOUNT=1000 CURRENCY=EUR npm run kafka:produce:reservation
```

Produce a local treasury repayment message through Kafka.
```shell
PROGRAM_ID=p-1 INVOICE_ID=i-4 npm run kafka:produce:release
```

Produce a local treasury reconciliation snapshot through Kafka.
```shell
PROGRAM_ID=p-1 TOTAL_LIMIT=10000000 RESERVED_AMOUNT=1250000 CURRENCY=USD npm run kafka:produce:reconciliation
```

Stop all services.
```shell
docker-compose stop
```

## Capacity API

- `POST /programs` creates a financing program with its initial capacity balance.
- `POST /fx-rates` creates a locally managed FX rate.
- `GET /programs/{programId}/capacity` returns total, reserved, and available capacity.
- `POST /programs/{programId}/reservations` reserves capacity for an external invoice.
- `POST /programs/{programId}/invoices/{invoiceId}/release` fully releases an existing reservation after repayment.

## Kafka Treasury Ingestion

- `cir-kafka` runs as a real single-node Kafka broker in local Compose using pinned image `apache/kafka:4.3.1`.
- The service consumes `treasury.capacity.events` when `KAFKA_ENABLED=true`.
- On startup, the service waits for Kafka readiness and creates/confirms the local topic before subscribing.
- `RESERVATION_APPROVED` messages create reservations with `source = KAFKA_TREASURY`.
- `INVOICE_REPAID` messages release existing reservations with `source = KAFKA_TREASURY`.
- `PROGRAM_RECONCILED` messages overwrite the capacity balance projection with `source = RECONCILIATION` and leave reservation rows unchanged.
- `treasury_kafka_messages` stores processed and rejected Kafka messages for idempotency and malformed-message audit records.
- Terminal capacity-domain `4xx` failures are stored with `status = REJECTED` and do not mutate reservations, capacity balances, or capacity events.
