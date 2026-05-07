#!/bin/sh
set -eu

echo "Mitaller API starting"
echo "NODE_ENV=${NODE_ENV:-unset}"
echo "PORT=${PORT:-unset}"

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL is not set. Link the Railway API service to PostgreSQL with DATABASE_URL=\${{Postgres.DATABASE_URL}}."
  exit 1
fi

echo "Applying Prisma schema"
npm run prisma:push

echo "Starting Nest API"
npm run start:api
