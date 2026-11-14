# Taskboard standalone install

This setup runs Taskboard and PostgreSQL on one machine with Docker and the Docker
Compose plugin. It uses the existing local administrator login. Ordinary local
accounts for team members and directory sign-in are later release work.

## Start Taskboard

From the checkout, copy `standalone.env.example` to `.env.standalone`. Run
`openssl rand -hex 32` twice (or use a password generator that produces random hex).
Paste one value into `POSTGRES_PASSWORD` and the other into `AUTH_SECRET`.
Keep `.env.standalone` private and reuse it on future starts.

```sh
cp standalone.env.example .env.standalone
# Fill in POSTGRES_PASSWORD and AUTH_SECRET before starting.
docker compose -p taskboard-standalone --env-file .env.standalone -f compose.standalone.yaml up -d --build --wait
```

Open `http://127.0.0.1:3000/setup` on the Docker host and claim the administrator
account. Then open `http://127.0.0.1:3000/` to use the board. Docker publishes the
app on loopback by default. Set `TASKBOARD_PORT` if the port is already in use.
Finish setup on loopback before opening access to other users.
If you serve the app over HTTPS, set `AUTH_COOKIE_SECURE=true`. Choose the bind
address and any HTTPS proxy to suit your installation.

To limit Node.js heap usage on a shared build host, set
`TASKBOARD_BUILD_NODE_OPTIONS=--max-old-space-size=1792` in `.env.standalone`.
This setting applies only when building the image.

## Stop and restart

```sh
docker compose -p taskboard-standalone --env-file .env.standalone -f compose.standalone.yaml down
docker compose -p taskboard-standalone --env-file .env.standalone -f compose.standalone.yaml up -d --wait
```

The project stores PostgreSQL data and uploaded files in separate Docker volumes.
Keep both volumes and the same project name when restarting. `down -v` deletes
both volumes. To inspect startup, run `logs app db` with the same Compose options.
