# Capacity Safety

This document defines the transaction, duplicate-operation, and concurrency contract for capacity reservation and release.

## Scope

Capacity safety covers transaction boundaries, duplicate business operation handling, and concurrency protection for the API-backed capacity path.

HTTP `Idempotency-Key` headers, idempotency-key storage, and response replay are out of scope. The service does not support that API contract, so duplicate protection is based on external business identifiers, reservation status, database constraints, and row-level locking.

Kafka message idempotency and reconciliation replay behavior are handled through the Kafka inbox contract defined in [`kafka-treasury-ingestion.md`](./kafka-treasury-ingestion.md).

Capacity comparisons and balance arithmetic follow the exact decimal contract in [`monetary-precision.md`](./monetary-precision.md).

## Duplicate Operation Contract

- A reservation is uniquely identified by `(program_id, invoice_id)`.
- `POST /programs/{programId}/reservations` must return `409 Conflict` when a reservation already exists for the same program and invoice.
- `POST /programs/{programId}/invoices/{invoiceId}/release` must return `409 Conflict` when the matching reservation is already `RELEASED`.
- Duplicate requests must not create duplicate reservations, duplicate release events, or double-apply balance changes.
- The service does not replay the original success response for duplicate HTTP requests.

## Transaction And Locking Strategy

Reservation creation should run in a single database transaction:

1. Resolve the program by `programs.external_id`.
2. Lock the matching `program_capacity_balances` row for update.
3. Check whether a reservation already exists for `(program_id, invoice_id)`.
4. Resolve the capacity-affecting amount and reject a cross-currency conversion that rounds to zero.
5. Validate available capacity using the locked balance row.
6. Insert the reservation.
7. Increase `reserved_amount`.
8. Insert the `RESERVATION_CREATED` capacity event.
9. Commit the transaction.

Reservation release should run in a single database transaction:

1. Resolve the program by `programs.external_id`.
2. Lock the matching `program_capacity_balances` row for update.
3. Select the matching reservation by `(program_id, invoice_id)` for update.
4. Return `404 Not Found` when no matching reservation exists.
5. Return `409 Conflict` when the reservation is already `RELEASED`.
6. Mark the reservation `RELEASED` with `released_amount = amount`.
7. Decrease `reserved_amount`.
8. Insert the `RESERVATION_RELEASED` capacity event.
9. Commit the transaction.

Both flows should lock rows in a consistent order: program lookup, capacity balance row, then reservation row when one exists. Balance arithmetic must use exact decimal operations and be committed with the reservation or release state change; partial updates are not acceptable.

A zero-after-conversion rejection returns `422 Unprocessable Entity` without inserting a reservation or capacity event and without changing `reserved_amount`.

## Concurrent Request Behavior

- Concurrent reservations for different invoices must be serialized at the program balance row so accepted reservations cannot push `reserved_amount` above `total_limit`.
- When concurrent reservation attempts exceed remaining capacity, only the requests that fit within the locked available amount may succeed; the rest return `409 Conflict`.
- Concurrent reservation attempts for the same invoice must result in one accepted reservation at most; later attempts return `409 Conflict`.
- Concurrent releases for the same invoice must release capacity once; later attempts return `409 Conflict`.
