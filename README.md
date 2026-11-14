# Taskboard

Taskboard is a self-hosted workspace for boards, tasks, teams, calendars, and
Folio notes.

## Install

Use Docker and the Docker Compose plugin to install the app and PostgreSQL on
one machine. See the [standalone install guide](docs/standalone-install.md) for
first-run setup and persistent storage.

## Development

Use Node.js 22 and `npm ci` to install dependencies. Run `npm run dev` for the
development server or `npm run build` for a production build. The standalone
install uses its own PostgreSQL database. Keep development and test data in
separate databases.

Run `npm run lint` for lint checks. Individual tests can be run with
`node --conditions react-server --import tsx --test tests/<file>.test.ts`.
The browser suite uses `npm run test:visual` and requires an isolated test database.

## License

Taskboard's own code is available under the [MIT License](LICENSE).
Third-party components retain the licenses listed in the
[third-party notices](THIRD_PARTY_NOTICES.md).
