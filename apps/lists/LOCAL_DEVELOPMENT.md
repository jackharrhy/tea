# Lists local stack

Tea runs Lists with disposable AWS emulation and captured SMTP through the root Compose profile:

```sh
docker compose --profile lists up --build --wait lists
```

Open <http://localhost:18080> for Lists and <http://localhost:18025> for the Mailpit inbox. Moto binds to loopback port 15000. The local owner is `owner@lists.local` with password `local-password`; these credentials and the AWS signing values in Compose are fake and must not be used in production.

The local application database and Mailpit messages live in `lists-data` and `lists-mailpit-data` volumes. `docker compose --profile lists down` stops services without deleting them. `BASE_URL` defaults to `http://localhost:18080`, so captured confirmation and unsubscribe links target the local app. Mail always goes to Mailpit, while Moto handles the local S3 and SQS calls.

Run focused checks from Tea's root:

```sh
npm run check --workspace @tea/lists
```

The Compose-backed suite can run inside the app container after the stack is healthy:

```sh
docker compose exec -T \
  -e LOCAL_E2E=1 \
  -e LOCAL_APP_URL=http://localhost:8080 \
  -e LOCAL_MOTO_URL=http://lists-moto:5000 \
  -e LOCAL_MAILPIT_URL=http://lists-mailpit:8025 \
  lists bun test __tests__/local-stack.e2e.test.ts --timeout 45000
```

The suite exercises API signup, confirmation through Mailpit, campaign draft/send, inbound S3/SQS processing, and DMARC ingestion. It uses only the synthetic local services. Production AWS resources, credentials, DNS, and backups live in the Infra repository.
