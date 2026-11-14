# Taskboard standalone install

This setup runs Taskboard and PostgreSQL on one machine with Docker and the Docker
Compose plugin. Use local Taskboard accounts, or add one OpenID Connect identity
provider alongside local sign-in.

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

## Add team members

Open **Admin → Users** and use **Add local account**. Give the user their username
and password securely. The new account has the standard role. In **Teams**, open
the team and add the user by name, email, or username. Team and board permissions
are managed in Taskboard.

## Set up OpenID Connect

In your provider, register a confidential web app using authorization code flow.
Require assignment in the provider and assign only the people or groups who
should be able to sign in to Taskboard. Configure
the app to use PKCE (S256), a client secret sent in the token request body
(`client_secret_post`), and an ID token with an email claim. Copy the following
values into `.env.standalone` and restart the Compose service with the same
`up -d --wait` command:

- `TASKBOARD_OIDC_ISSUER` is the provider's HTTPS issuer. For single-tenant
  Microsoft Entra ID, use `https://login.microsoftonline.com/<tenant-id>/v2.0`.
- `TASKBOARD_OIDC_CLIENT_ID` and `TASKBOARD_OIDC_CLIENT_SECRET` come from your
  provider's app registration.
- `TASKBOARD_OIDC_CALLBACK_URL` is the exact redirect URI you registered, such as
  `https://taskboard.example.com/api/auth/oidc/callback`. Set
  `AUTH_COOKIE_SECURE=true` for an HTTPS callback. Use the callback's origin to
  open Taskboard in the browser.

After the administrator claims the installation, an assigned user can select
**Sign in with your identity provider**. Their first successful sign-in creates
a standard Taskboard account. Add them to the appropriate teams in Taskboard.
Each directory identity keeps the same Taskboard account across sign-ins. If
its email is already in use by another Taskboard account, the first sign-in
fails. Use a dedicated app registration and restrict sign-in at your provider.
For Active Directory or LDAP, use an OpenID Connect provider connected to that
directory. Keep your local administrator credentials for account recovery.

Disabling a user in **Admin → Users** signs them out of Taskboard and blocks
new sign-ins. Apply this in Taskboard when removing access immediately. Removing
access at the identity provider blocks future provider sign-ins.

Local password sign-in limits repeated attempts per account within each
Taskboard process.

## Stop and restart

```sh
docker compose -p taskboard-standalone --env-file .env.standalone -f compose.standalone.yaml down
docker compose -p taskboard-standalone --env-file .env.standalone -f compose.standalone.yaml up -d --wait
```

The project stores PostgreSQL data and uploaded files in separate Docker volumes.
Keep both volumes and the same project name when restarting. `down -v` deletes
both volumes. To inspect startup, run `logs app db` with the same Compose options.
