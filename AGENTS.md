<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Public release checks

When asked to prepare, publish, or deploy a public Taskboard release, run and
monitor the advisory standalone rehearsal as part of the release work. Routine
pull requests and pushes use the automatic advisory checks.

Record the public candidate ref and commit SHA. For an upgrade, use the SHA of
the public version being replaced. Resolve it from the deployment record or
release tag. If releases are still published through `main` without tags, record
the public `main` SHA before advancing it and use that as the baseline. The
baseline must be in the candidate's public Git history. Pass an empty baseline
to rehearse a fresh install. Set `restore` to `true` when changes affect backup
or recovery, including database privileges or upload storage. Otherwise use `false`.

Reuse a successful rehearsal when its `headSha` matches the candidate and its
logs confirm the requested baseline and restore mode. Otherwise dispatch it
from the public candidate branch or tag, supplying the values you recorded.

```bash
gh workflow run advisory-standalone.yml --repo wildbillwilly-a51/taskboard-public \
  --ref "$candidate_ref" -f "previous_revision=$previous_sha" -f "restore=$restore"
gh run watch "$run_id" --repo wildbillwilly-a51/taskboard-public --exit-status
```

Use the returned run URL to get the run ID. If the CLI gives no URL, find the
new `workflow_dispatch` run for the recorded candidate SHA. Confirm its
`headSha`, wait for completion, investigate failures, and include the run URL
and outcome in the release report. These checks are advisory. Follow the
user's instructions for publishing and deployment.
