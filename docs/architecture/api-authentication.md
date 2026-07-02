# API Authentication

This document defines the authentication contract for public HTTP endpoints.

## Scope

The service's public HTTP API uses a custom Hapi authentication scheme and a static service API token.

The service is assumed to be consumed by other API services rather than end users. User accounts, roles, sessions, OAuth/OIDC, and JWT issuance are out of scope for this service.

## Assumptions

- The service is used for service-to-service API calls.
- A simple static API token is sufficient for service-to-service authentication in the local environment.
- The API token is configured locally through environment variables, not stored in the database.
- No new authentication dependency is required; the service should use a custom Hapi auth scheme.
- `GET /health` remains unauthenticated because clustered deployments commonly use unauthenticated liveness and readiness checks.
- All other public HTTP endpoints require authentication.

## Token Contract

Clients must send the token in the `Authorization` header:

```http
Authorization: Bearer <API_TOKEN>
```

Runtime configuration:
- `API_TOKEN` - required static token for local and deployed service runtime.

`.env.local.example` is for local database and migration commands and does not register authenticated routes, so it does not require `API_TOKEN`.

The service should fail startup with a clear configuration error when `API_TOKEN` is missing in runtime environments that register authenticated routes.

## Hapi Contract

The service uses a custom Hapi auth scheme, for example `bearer-token`, and registers a strategy such as `api-token`.

Authentication rules:
- Parse `Authorization` as a Bearer header.
- Missing, malformed, or invalid tokens fail authentication.
- Valid tokens authenticate with minimal credentials such as `{ tokenType: 'static-api-token' }`.
- Do not log the raw token.
- Use Node.js built-in APIs only; do not add a dependency for static token comparison.

The API token strategy is the server default auth strategy, with auth explicitly disabled only for `GET /health`.

## Protected Routes

The following routes must require `Authorization: Bearer <API_TOKEN>`:

- `POST /programs`
- `POST /fx-rates`
- `GET /programs/{programId}/capacity`
- `POST /programs/{programId}/reservations`
- `POST /programs/{programId}/invoices/{invoiceId}/release`

`GET /health` must remain accessible without authentication.

## Failure Response

Missing, malformed, or invalid credentials should return `401 Unauthorized`.

Response payload:

```json
{
  "statusCode": 401,
  "error": "Unauthorized",
  "message": "Authentication required"
}
```

The response should include a Bearer challenge header when supported by the Hapi/Boom response path.
