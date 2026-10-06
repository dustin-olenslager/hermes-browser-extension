# Agent policy

This file is the agent-agnostic home for the guardrails that were previously expressed as a
Tool-specific `.agents/policy.md` permission list. Because the project must work with any agent
or LLM platform, these are written as MUST-NOT doctrine and safe-default guidance, not as a tool-
specific permission file. If your tool supports its own permission model, translate this file into
that format locally — but keep this file as the single source of truth.

## Honest scope

- **This file is prose.** It binds no tool that does not read it. A permission gate in a specific
  agent's config is real for that agent only and does nothing for others.
- **The real backstop is server-side:** branch protection on the default branch (no force-push, no
  direct pushes) and required CI status checks (tests, typecheck, lint, architecture boundary, secret
  scan, docs gates). Turn those on and mark them required — until then, the only cross-tool guard is
  this prose.

## MUST NOT — hard guardrails

These are non-negotiable for any agent working in this repo. If a tool cannot enforce them, the
human operator is responsible for honoring them anyway.

### Secrets and credentials
- Never read or print secrets: `.env`, `*.pem`, `id_rsa*`, `id_ed25519*`, `.aws/`, `.ssh/`,
  `credentials.json`, `service-account*.json`, or any file containing keys/tokens.
- Never put a credential in a git remote URL or a commit.

### Destructive filesystem operations
- Never run recursive or wildcard deletions such as `rm -rf /`, `rm -rf *`, `find ... -delete`,
  `shred *`, `mkfs*`, `dd ... of=/dev/*`, or broad `truncate`.

### Privilege escalation
- Never run `sudo`, `su`, `doas`, `runas`, broad `chmod -R`, `chmod 777`, or `chown -R`.

### Process termination
- Never run `kill -9 *`, `killall *`, `pkill -9 *`, or broad process shutdowns.

### Git history rewriting
- Never force-push, `git reset --hard`, `git checkout -- .`, `git restore .`, rewrite published
  history, delete branches/tags, `git filter-branch`, `git filter-repo`, `git reflog expire`,
  `git gc --prune=now`, `git update-ref -d`, or clear stashes/tags.

### Arbitrary code execution from the network
- Never pipe the network to a shell such as `curl ... | bash/sh/zsh/python/node`,
  `wget ... | bash`, or equivalent.

### Publishing and deployment
- Never publish a package or deploy (`npm publish`, `cargo publish`, `docker push`, `mvn deploy`,
  etc.) unless explicitly asked and a human has approved.

### Destructive database operations
- Never run destructive DB commands: `db:push`, `db:drop`, `db:reset`, `db:migrate:undo:all`,
  `db:schema:load`, `drizzle-kit push`, `prisma db push`, `prisma migrate reset`,
  `typeorm schema:drop`, `typeorm schema:sync`, `knex migrate:rollback --all`,
  `alembic downgrade base`, `supabase db reset`, `dotnet ef database drop`, `manage.py flush`,
  `manage.py reset_db`, `dropdb`, or raw `DROP`.

## Safe defaults — commands that are normally read-only or local

The following are the kinds of commands an agent is expected to run by default for inspection,
verification, and routine repo operations. Any command outside this pattern that mutates state
should be proposed explicitly.

- `git` read/status/diff/log/show/branch/remote/rev-parse/ls-files/shortlog/describe/stash-list/config-get
- inspection: `ls`, `pwd`, `tree`, `cat`, `head`, `tail`, `wc`, `file`, `which`, `echo`
- version checks: `node --version`, `python --version`, `python3 --version`, `go version`, `cargo --version`
- JS verify: `npm ls`, `npm run test`, `npm run lint`, `npm run typecheck`, `npm run check`, `npm test`,
  `pnpm ls`, `pnpm test`, `pnpm run test`, `pnpm run lint`, `pnpm run typecheck`, `yarn test`,
  `yarn lint`, `yarn typecheck`, `bun test`, `npx tsc --noEmit`, `tsc --noEmit`, `npx eslint`,
  `npx prettier --check`, `npx vitest run`, `npx jest`, `biome check`
- Python verify: `pytest`, `ruff check`, `mypy`, `black --check`, `uv run pytest`, `uv run mypy`,
  `uv run ruff check`, `uv run black --check`, `poetry run pytest`, `poetry run mypy`,
  `poetry run ruff check`, `poetry run black --check`, `pipenv run pytest`, `pdm run pytest`
- Rust/Go/Ruby/.NET/Java verify: `go test`, `go vet`, `go build ./...`, `gofmt -l`, `cargo check`,
  `cargo clippy`, `cargo test`, `cargo fmt --check`, `bundle exec rspec`, `rubocop`, `dotnet build`,
  `dotnet test`, `mvn -q test`, `./gradlew test`
- Task runners: `make lint`, `make test`, `make typecheck`, `just lint`, `just test`
- GitHub CLI read: `gh pr view`, `gh pr list`, `gh pr diff`, `gh issue view`, `gh issue list`,
  `gh run list`, `gh run view`

## Local overrides

Put machine-local or personal overrides in `.agents/settings.local.json` or `AGENTS.local.md`. Never
commit them.
