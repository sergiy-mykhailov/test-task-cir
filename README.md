# Program Capacity &amp; Invoice Reservation

## Installation

- Install Docker.

- Install Node.js.

- Copy `.env.example` to `.env` and `.env.local.example` to `.env.local`.

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

## Additional commands

Stop all services.
```shell
docker-compose stop
```