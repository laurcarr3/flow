# Integration verification

Verified on 2026-10-22, with Node 24.19.0.

The installed T3 desktop package exposed MCP project/thread tools, but its command help did not include the recent `t3 thread` CLI. The adapter therefore uses OAuth HTTP MCP through `mcp-remote`, with the official MCP SDK consuming its stdio transport. This avoids relying on an incomplete CLI workspace binding.

Interfaces were checked against the live tool catalog and [T3's outside-agent documentation](https://github.com/pingdotgg/t3code/blob/main/docs/user/outside-agents.md). The installed application was inspected read-only to confirm its supported OAuth `/mcp` endpoint; no T3 database or private authentication store was opened, and no T3 checkout was changed.

The live smoke test used a newly created disposable repository containing only a greeting function and README:

1. Registered the fixture through `t3_project_create`.
2. Started a top-level implementation thread through `t3_thread_launch` with `workspaceStrategy.type = worktree`, `baseRef = main`, and `startFromOrigin = false`.
3. Observed preparation and retained the returned thread/run IDs. `t3_thread_read` confirmed a T3-owned worktree and the requested branch.
4. The agent added a small Node test, executed it, and returned structured acceptance evidence.
5. Started a separate reviewer with `workspaceStrategy.type = existing_worktree`, the exact returned worktree path, and the same branch.
6. Read the review's binding and JSON verdict. Both thread bindings matched, their thread IDs differed, and the review passed with no findings.
7. Re-ran local validation in the fixture using the explicit Node 24 executable (1 passing test). The shell in the disposable checkout initially resolved Node 16, which rejected `--test`; selecting the required runtime corrected the validation environment. No commits beyond the fixture's initialization, remote pushes, or PRs were authorized for these agent tasks.

The smoke test used this session's supported MCP connection, **not flow's external OAuth proxy**. Consequently it verifies the T3 wire contract and worktree behavior but does not prove external login, access-mode approval, or the full production transport. Those require a configured T3 MCP URL and browser authorization. flow does not reuse this session's credentials.

Automated tests separately exercise the adapter's request arguments, paginated/truncated results, foreign-project rejection, and durable runner behavior with fake execution. Publication uses real local Git and a fake GitHub CLI, including a response-lost scenario after PR creation. GitHub creation/linking against a real remote was deliberately not tested because this task did not authorize test PRs.

Material design decisions:

- Node 24's built-in SQLite avoids a native database addon; `pnpm-lock.yaml` pins dependencies.
- Approval is machine-local and hashes the complete ready document. Runtime state does not appear in Markdown.
- Base commits come from an explicit fetch of the configured remote base branch.
- Independent review means a fresh T3 conversation, not necessarily a different model/vendor.
- An uncertain non-idempotent launch pauses when reconciliation finds no unique match. Retrying requires an explicit operator flag after inspecting T3.
- Review/validation identify candidate contents by Git tree ID. flow may reuse an agent-created commit only if its tree matches; it verifies ancestry from the saved base.
- Required validation commands and the revision bound are frozen with the job. Changes to these settings apply to future jobs.
- No external agent framework was added. `Executor` contains only the operations needed by the implemented workflow.

## Direct feature drafting

Feature drafting now uses local Codex or Claude CLI subprocesses. T3 remains the execution backend for implementation and independent review.

Interface references:

- [Codex noninteractive mode](https://learn.chatgpt.com/docs/non-interactive-mode): stdin prompts, JSON events, and read-only execution.
- [Claude programmatic execution](https://code.claude.com/docs/en/headless): print mode and structured results.
- [Claude CLI reference](https://code.claude.com/docs/en/cli-reference): tool restrictions and provider authentication.

The installed CLI help confirmed the invocation flags. Deterministic tests cover both output protocols, provider selection, failed calls, interrupted attempts, cached output, and legacy T3 request migration. No standalone implementation or review adapter was added.

Direct drafting verification on 2026-10-23:

- A live Codex call drafted a PRD in a disposable repository with no T3 connection configured.
- The returned document passed validation, retained an open question, and saved with `status: draft`.
- CLI tests select both providers through temporary fixture executables, without T3 access.
- Claude's live authentication check reported that it was not signed in. Live Claude generation remains unverified; its command and result handling have fixture coverage.
