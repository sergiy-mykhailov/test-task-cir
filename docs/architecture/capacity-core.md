# Capacity Core

This document defines the core Program Capacity and Invoice Reservation model.

Concurrency and duplicate operation hardening for this model is defined separately in [`capacity-safety.md`](./capacity-safety.md). Cross-currency invoice reservation handling is defined separately in [`capacity-currency.md`](./capacity-currency.md).

## Scope

The core capacity model covers the synchronous API and database model for current program capacity, invoice reservations, and full reservation release after repayment.

Kafka-originated reservation or repayment events apply the same domain operations as the API instead of maintaining a separate capacity path.

## Assumptions

- The service may track multiple financing programs, each with its own credit limit and currency. A `programs` table is used even if local data starts with one program.
- The invoice lifecycle is owned by an external system. This service stores `invoice_id` on reservations and does not create an `invoices` table.
- A repayment fully releases the related reservation. Partial repayments and partial releases are not supported.

## Tables

### `programs`

Stores financing program identity and stable metadata.

- `id` - primary key.
- `external_id` - stable external program identifier, unique.
- `currency` - ISO 4217 program currency.
- `created_at`, `updated_at`.

Public API paths use `programId` to mean `programs.external_id`, not the internal database primary key.

### `program_capacity_balances`

Stores the current capacity projection for a program.

- `program_id` - primary key and foreign key to `programs.id`.
- `total_limit` - current total credit limit in the program currency.
- `reserved_amount` - currently reserved amount in the program currency.
- `updated_at`.

`available_amount` is returned as `total_limit - reserved_amount`; it does not need a separate stored column.

### `reservations`

Stores one reservation per external invoice within a program.

- `id` - primary key.
- `program_id` - foreign key to `programs.id`.
- `invoice_id` - external invoice identifier.
- `amount` - reserved capacity amount in the program currency.
- `currency` - program currency for the capacity-affecting amount.
- `status` - `RESERVED` or `RELEASED`.
- `released_amount` - `0` while reserved, equal to `amount` after release.
- `reserved_at`, `released_at`.
- `created_at`, `updated_at`.

Use a unique constraint on `(program_id, invoice_id)` so the same invoice cannot create more than one active reservation for the same program.

### `capacity_events`

Stores an audit trail for capacity-affecting API operations.

- `id` - primary key.
- `program_id` - foreign key to `programs.id`.
- `reservation_id` - nullable foreign key to `reservations.id`.
- `event_type` - capacity event type.
- `source` - event source.
- `invoice_id` - external invoice identifier when available.
- `amount` - event amount in the program currency.
- `currency` - program currency.
- `occurred_at`, `created_at`.

`event_type` values:
- `PROGRAM_CREATED` - a program and its initial capacity balance were created.
- `RESERVATION_CREATED` - a reservation was accepted and increased `reserved_amount`.
- `RESERVATION_RELEASED` - a repayment release was accepted and decreased `reserved_amount`.
- `RECONCILIATION_APPLIED` - a treasury reconciliation snapshot updated the capacity balance projection.

`source` values:
- `API` - event was produced by a synchronous HTTP endpoint.
- `KAFKA_TREASURY` - event was produced from an incremental treasury Kafka message.
- `RECONCILIATION` - event was produced from a treasury reconciliation snapshot.

## Endpoints

### `POST /programs`

Creates a financing program and its initial capacity balance for local/API-driven setup.

Request fields:
- `externalId`
- `currency`
- `totalLimit`

Rules:
- `externalId` must be unique.
- `currency` must be a valid three-letter ISO 4217 code.
- `totalLimit` must be positive.
- The created balance starts with `reserved_amount = 0`.
- `availableAmount` is returned as `totalLimit`.

Response should include the created program and its current capacity.

### `GET /programs/{programId}/capacity`

Returns current capacity for a program.

Response fields:
- `programId`
- `currency`
- `totalLimit`
- `reservedAmount`
- `availableAmount`
- `updatedAt`

### `POST /programs/{programId}/reservations`

Creates a reservation for an external invoice.

Request fields:
- `invoiceId`
- `amount`
- `currency`

Rules:
- `amount` must be positive.
- `currency` is the invoice currency and may differ from the program currency when a usable FX rate exists.
- The reservation must fail when `amount` exceeds available capacity.
- Duplicate reservations for the same `(program_id, invoice_id)` are not allowed.

Response should include the created reservation and refreshed capacity.

### `POST /programs/{programId}/invoices/{invoiceId}/release`

Fully releases an existing reservation after repayment using the external business identifiers known by the caller.

Rules:
- The service finds the reservation by `programs.external_id` and `reservations.invoice_id`.
- Only `RESERVED` reservations can be released.
- The release amount is always the full outstanding reservation amount.
- Releasing an already released reservation is invalid and returns `409 Conflict`.

Response should include the released reservation and refreshed capacity.

## Failure Responses

Use the service's established error response format.

- `400 Bad Request` - request validation failed, including missing required fields, non-positive amount, or malformed identifiers.
- `404 Not Found` - program or reservation for the requested invoice does not exist.
- `409 Conflict` - duplicate program `external_id`, insufficient available capacity, duplicate reservation for the same `(program_id, invoice_id)`, or release requested for a reservation that is already `RELEASED`.
- `422 Unprocessable Entity` - cross-currency reservation has no usable direct FX rate.

Authentication failures are defined in [`api-authentication.md`](./api-authentication.md).
