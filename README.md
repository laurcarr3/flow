# flow

flow is a local command-line interface (CLI) written in TypeScript. It converts approved Markdown feature documents into implemented features with independently reviewed draft GitHub pull requests (PRs).

Codex or Claude drafts feature documents through its local CLI. T3 Code runs implementation and review agents. flow controls approval, workflow decisions, and saved execution state. flow never merges PRs.

## Install flow

Required software:

- Node 24 or later.
- pnpm 11.20.0 (the version pinned in `package.json`).
- Git.
- GitHub CLI (`gh`).

1. Open a terminal in the flow repository.
2. Install the dependencies:

   ```sh
   pnpm install --frozen-lockfile
   ```

3. Build the CLI:

   ```sh
   pnpm run build
   ```

4. Install the built CLI globally (run `pnpm setup` first if pnpm asks for a global bin directory):

   ```sh
   pnpm add --global .
   ```

5. Check the available commands:

   ```sh
   flow --help
   ```

6. Sign in to GitHub:

   ```sh
   gh auth login
   ```

Other ways to start flow:

- Use `node /absolute/path/to/flow/dist/main.js` without `pnpm add --global .`.
- Use `pnpm run dev <command>` to run the source code.

flow is a separate project. It does not modify T3 Code.

## Quick start

In the target repository, run `flow init` to configure T3 and required validation
commands. Install and authenticate Codex CLI or Claude Code for feature drafting.
Drafting works without T3; implementation and review require a configured T3 connection.

1. Run `flow new`, choose a provider, and describe the feature.
2. Edit the generated document in `features/` and resolve its open questions.
3. Run `flow ready` to approve the document.
4. Run `flow run` to start implementation and independent review.
5. Use `flow status` to inspect progress and `flow resume` to continue saved work.

Run `flow` without arguments for the interactive menu. flow opens draft PRs for
human review; it never merges them.

## Documentation

- [User guide](docs/user-guide.md): provider setup, T3 connection, configuration,
  commands, feature documents, approval, recovery, JSON export, and v0 limits.
- [Architecture and contributor guide](docs/architecture.md): module ownership,
  code reading order, saved state, and verification commands.
- [Visual system overview](docs/overview.html): workflow stages and recovery;
  open the HTML file in a browser.
- [Integration verification](docs/integration-verification.md): what has been
  verified against real integrations and what remains simulated.
- [Example feature document](examples/export-conversation.md).

## Verify flow

1. Check the TypeScript code:

   ```sh
   pnpm run check
   ```

2. Run the tests:

   ```sh
   pnpm test
   ```

3. Build the CLI:

   ```sh
   pnpm run build
   ```

The tests cover:

- Invalid documents and dependency cycles.
- Approval invalidation after document changes.
- Workflow requirements and revision limits.
- Interrupted operations and unknown launch outcomes.
- Live and stale process claims.
- MCP response parsing.
- Publication recovery without duplicate PRs.
- Repeatable JSON output and CLI behavior.

Publication tests use real Git with a disposable local bare remote. They use a simulated GitHub CLI and create no real PRs.

Live T3 tests confirmed:

- T3-owned worktree creation.
- An independent reviewer's binding to the same checkout.
- Structured agent results.
- Local validation in an isolated project.

Unverified operations:

- External OAuth login through flow.
- A complete production run from flow to GitHub.

See the [verification details](docs/integration-verification.md).
