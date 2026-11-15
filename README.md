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

GitHub Actions reports advisory checks on pull requests and direct pushes to
`main`. The fast job installs the lockfile and runs lint for the check scripts,
unit tests, selected PostgreSQL access tests, and type checking. Run the same unit tests locally
with `node scripts/check-tests.mjs unit`. For the PostgreSQL checks, set
`DATABASE_URL` to a disposable PostgreSQL 17 database named
`taskboard_visual_test_folio` on loopback, then run
`node scripts/check-tests.mjs database`.

Changes to the container, migrations, or core standalone routes also run a fresh
Compose smoke test. Use **Advisory standalone checks → Run workflow** in GitHub
Actions to test the selected branch against a previous public commit. Use the
full commit SHA of the previous public release, or clear it for a fresh install.
Select **Also restore a backup into empty volumes** to check the documented
restore with synthetic data and compare PostgreSQL function permissions. On
Linux with Docker Compose and Node.js 22, the same check runs through
`bash scripts/check-standalone.sh [previous-public-sha] [true|false]`.
The workflow reports results without publishing a release.

## License

Taskboard's own code is available under the [MIT License](LICENSE).
Third-party components retain the licenses listed in the
[third-party notices](THIRD_PARTY_NOTICES.md).
