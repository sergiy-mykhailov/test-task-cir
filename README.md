# Program Capacity &amp; Invoice Reservation

## Installation

- Install Docker

- Install Node.js

- Copy `.env.example` to `.env` and `.env.local.example` -> `.env.local`

- Install npm dependencies
```shell
npm ci
```

- Start all
```shell
docker-compose up -d
```

- Create a database
```shell
npm run db:create
```

## Additional commands

Stop all
```shell
docker-compose stop
```