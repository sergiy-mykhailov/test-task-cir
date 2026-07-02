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
- Kafka integration may later deliver reservation and repayment events from the treasury system. Those events should reuse the same capacity domain operations as the API.

## Installation

- Install Docker.

- Install Node.js.

- Copy `.env.example` to `.env`, `.env.local.example` to `.env.local`, and `.env.test.example` to `.env.test`.

- Set `API_TOKEN` in `.env` for the local service runtime.

- Install npm dependencies.
```shell
npm ci
```

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
