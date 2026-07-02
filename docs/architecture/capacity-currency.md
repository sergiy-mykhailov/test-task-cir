# Capacity Currency Handling

This document defines the cross-currency reservation contract for Program Capacity and Invoice Reservation.

## Scope

Invoices may be reserved when invoice currency differs from the program currency. Program capacity remains denominated and calculated in the program currency.

External FX providers are out of scope. FX rates are managed locally in the service through the `fx_rates` table and a minimal local API.

## Assumptions

- FX rates are managed locally in the service.
- There is no separate `currencies` table; currencies are validated as uppercase ISO 4217-style three-letter codes.
- The service uses only direct rates from invoice currency to program currency. It does not auto-invert rates or derive cross rates through a third currency.
- Same-currency reservations do not require an FX rate row.
- The FX rate is selected and fixed at reservation time. Release does not re-convert currency.

## Tables

### `fx_rates`

Stores locally managed FX rates.

- `id` - primary key.
- `base_currency` - invoice currency being converted from.
- `quote_currency` - program currency being converted to.
- `rate` - positive conversion rate from `base_currency` to `quote_currency`.
- `effective_at` - timestamp from which the rate is usable.
- `created_at`.

Use a unique constraint on `(base_currency, quote_currency, effective_at)` so the same local rate timestamp cannot be inserted twice for the same pair.

### `reservations`

Extend the existing table with invoice-currency and FX tracking fields.

- `invoice_amount` - original invoice amount from the reservation request.
- `invoice_currency` - original invoice currency from the reservation request.
- `amount` - converted reserved amount in the program currency.
- `currency` - program currency for the reserved amount.
- `fx_rate_id` - nullable foreign key to `fx_rates.id`; `null` for same-currency reservations.

Existing `released_amount` remains denominated in `currency`, which is the program currency.

## FX Rate API

### `POST /fx-rates`

Creates a locally managed FX rate for local operation.

Request fields:
- `baseCurrency`
- `quoteCurrency`
- `rate`
- `effectiveAt`

Rules:
- `baseCurrency` and `quoteCurrency` must be uppercase three-letter currency codes.
- `baseCurrency` and `quoteCurrency` must differ.
- `rate` must be positive.
- `effectiveAt` must be a valid timestamp.
- Duplicate `(baseCurrency, quoteCurrency, effectiveAt)` values return `409 Conflict`.

Response fields:
- `id`
- `baseCurrency`
- `quoteCurrency`
- `rate`
- `effectiveAt`
- `createdAt`

This endpoint requires the same API authentication as other public business endpoints.

## Reservation Conversion

`POST /programs/{programId}/reservations` keeps the existing request shape:

- `invoiceId`
- `amount`
- `currency`

Request `amount` and `currency` represent the original invoice amount and invoice currency.

Rules:
- If request `currency` equals the program currency, store `invoice_amount = amount`, `invoice_currency = currency`, `amount = amount`, `currency = program.currency`, and `fx_rate_id = null`.
- If request `currency` differs from the program currency, select the latest `fx_rates` row where `base_currency = request.currency`, `quote_currency = program.currency`, and `effective_at <= reservation timestamp`.
- If no usable direct FX rate exists, return `422 Unprocessable Entity`.
- Converted reserved amount is `invoice_amount * rate`.
- Round the converted reserved amount to two decimal places before capacity comparison, persistence, event creation, and response formatting.
- Capacity checks, balance updates, `capacity_events.amount`, and release use the converted `amount` in program currency.
- Release uses the stored reservation `amount`; it does not look up a new FX rate.

When multiple rates match, select the newest by `effective_at desc, id desc`.

## Reservation Response

Reservation responses should include both original invoice fields and reserved program-currency fields:

- `invoiceId`
- `invoiceAmount`
- `invoiceCurrency`
- `amount`
- `currency`
- `fxRateId`
- `status`
- `reservedAt`
- `releasedAt`

`amount` and `currency` remain the capacity-affecting reserved amount and program currency.

## Failure Responses

- `400 Bad Request` - malformed currency, non-positive amount or rate, malformed timestamp, or missing required fields.
- `404 Not Found` - program or reservation does not exist.
- `409 Conflict` - duplicate reservation, insufficient converted capacity, duplicate FX rate timestamp, or already released reservation.
- `422 Unprocessable Entity` - cross-currency reservation has no usable direct FX rate.
