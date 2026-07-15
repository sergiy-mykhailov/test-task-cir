# Monetary Precision

This document defines exact decimal representation and arithmetic for capacity amounts and FX rates.

## Representation

- PostgreSQL `numeric` remains the storage type for monetary values and FX rates.
- PostgreSQL `NUMERIC` values must remain decimal strings in Node.js; they must not be registered with a `Number` type parser.
- Domain arithmetic uses the approved `big.js` dependency with `Big.strict = true`.
- `Big` values may be constructed only from decimal strings or existing `Big` values. Monetary values and rates must not pass through JavaScript `Number`, `parseFloat`, `Math.round`, arithmetic operators, or `toNumber`.
- Values written to PostgreSQL and exposed outside the domain are serialized as plain base-10 decimal strings without exponent notation. Trailing fractional zeros are not significant.
- Database identifiers and Kafka metadata are not monetary values and keep their existing representation.

## Decimal String Contract

External decimal values use JSON strings such as `"10000000.01"`, `"0.05"`, and `"1.25"`.

A valid decimal string:

- contains at most 64 characters;
- uses digits with an optional fractional part;
- does not contain a sign, exponent, surrounding whitespace, separators, or currency symbols;
- matches `^(0|[1-9][0-9]*)(\.[0-9]+)?$`.

Positive fields must compare greater than zero through `Big`. Non-negative fields may equal zero. JSON numeric values are rejected rather than coerced.

The API uses decimal strings for these request, response, and monetary error-detail fields:

- `totalLimit`, `reservedAmount`, and `availableAmount`;
- `invoiceAmount`, `amount`, and `releasedAmount`;
- `rate`.

## Arithmetic Rules

- Available capacity is calculated as exact `totalLimit.minus(reservedAmount)`.
- Reservation capacity checks use `Big` comparison methods.
- Reservation and release balance changes use `plus` and `minus`.
- Same-currency reservations preserve the exact submitted decimal amount without additional rounding.
- Cross-currency conversion uses exact `invoiceAmount.times(rate)` and then rounds once to two decimal places with `Big.roundHalfUp` before comparison, persistence, event creation, and response serialization.
- When a positive cross-currency invoice amount rounds to zero in program currency, reject the reservation with `422 Unprocessable Entity` before the capacity comparison or any state mutation. Do not round the result up to a minimum reservation amount.
- The zero-after-conversion error data contains `invoiceAmount`, `invoiceCurrency`, `convertedAmount`, and `currency`; both monetary values are decimal strings and `convertedAmount` is `"0"`.
- Release uses the stored converted reservation amount and performs no FX recalculation.
- Reconciliation compares and stores `totalLimit` and `reservedAmount` through exact decimal operations.

## Kafka Contract Version

Treasury messages use `schemaVersion = 2` after adopting decimal strings.

- `RESERVATION_APPROVED.amount` is a positive decimal string.
- `PROGRAM_RECONCILED.totalLimit` is a positive decimal string.
- `PROGRAM_RECONCILED.reservedAmount` is a non-negative decimal string.
- `INVOICE_REPAID` also uses `schemaVersion = 2` so the topic has one active schema version.
- Version 1 messages and version 2 messages with JSON numeric monetary fields are rejected through the existing inbox rejection path without capacity mutation.
- Local producer scripts emit version 2 messages and preserve monetary environment values as validated decimal strings.

## Storage Compatibility

No monetary column migration is required because the current columns already use PostgreSQL `numeric`. Existing rows are read as exact decimal strings after the runtime parser change.

Automated correction of historical values is out of scope because the current schema does not define enough information to distinguish legitimate higher-scale values from prior floating-point artifacts. A treasury reconciliation snapshot may correct the current balance projection when needed; it does not rewrite reservations or capacity-event history.
