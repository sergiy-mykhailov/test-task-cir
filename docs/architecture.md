# Architecture

## Capacity Domain

- [`capacity-core.md`](./architecture/capacity-core.md) - core program capacity tables, reservation/release API contracts, and domain assumptions.
- [`capacity-safety.md`](./architecture/capacity-safety.md) - transaction, duplicate operation, and concurrent capacity protection contract.
- [`capacity-currency.md`](./architecture/capacity-currency.md) - local FX rate storage and cross-currency reservation conversion contract.
- [`monetary-precision.md`](./architecture/monetary-precision.md) - exact decimal representation, arithmetic, rounding, and external value contracts.

## Integrations

- [`kafka-treasury-ingestion.md`](./architecture/kafka-treasury-ingestion.md) - Kafka broker, consumer, message schema, idempotency, terminal rejection, and local producer-script contract.
- [`kafka-bulk-reconciliation.md`](./architecture/kafka-bulk-reconciliation.md) - Kafka full-state reconciliation snapshot contract.

## API Security

- [`api-authentication.md`](./architecture/api-authentication.md) - service-to-service API token authentication contract and health-check exception.
