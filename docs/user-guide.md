# User guide

[Back to README](../README.md)

## Select a drafting provider

Drafting requirements:

- Install Codex CLI or Claude Code on `PATH`.
- Sign in with `codex login` or `claude auth login`.
- Run `flow new`.
- Select Codex or Claude when flow asks.
- Enter the feature description.

Drafting does not require a T3 connection. Each provider uses its own supported authentication. flow does not store credentials.

## Connect to T3

T3 requirements:

- Run a T3 version with MCP project tools and these thread tools: `t3_thread_launch`, `t3_thread_read`, `t3_thread_list`, and `t3_thread_send`.
- Open the target repository as a T3 project.
- Sign in to the selected agent provider through T3.
- Keep the repository and T3 worktrees on the same filesystem as flow.

Connection procedure:

1. Open **Settings → Connections** in T3.
2. Copy the environment's MCP URL.
3. Set `t3.url` in `flow.config.json`, or set the `FLOW_T3_URL` environment variable.
4. Start an approved feature with `flow run <id>`.
5. When the browser opens, authorize flow to start and edit threads.

flow uses the MCP SDK and the installed `mcp-remote` OAuth proxy. The proxy keeps OAuth credentials in `~/.mcp-auth`, or in `MCP_REMOTE_CONFIG_DIR` if you set it. T3 manages the provider credentials.

Credential requirements:

- Keep the OAuth cache outside the repository.
- Do not put tokens in feature documents or configuration files.
- Do not put tokens in URL query parameters or CLI arguments.
- Use HTTPS, except for local loopback connections.

The adapter uses supported MCP tools. It does not read T3 databases. The newer `t3 thread` CLI is not required.

See the [T3 outside-agent documentation](https://github.com/pingdotgg/t3code/blob/main/docs/user/outside-agents.md) and [integration verification](integration-verification.md).

## Configure a repository

1. Open a terminal in a normal Git checkout.
2. Initialize flow:

   ```sh
   flow init
   ```

   This command creates `features/` and `flow.config.json`. It also adds `.flow/` to `.gitignore`.

3. Follow the setup prompts:
   - Enter the T3 MCP URL, or keep the environment setting.
   - Set the base branch and Git remote.
   - Add required validation commands. Select package scripts, or enter an executable and each argument separately.
   - Check the configuration summary and confirm Save.
   - Do not enter credentials. Use the provider's sign-in process.

   Run `flow init` again to change these settings. Existing settings remain until you confirm Save. For scripts, use `flow init --defaults` to create missing files without prompts.

   You can also edit `flow.config.json` directly:

   ```json
   {
     "version": 1,
     "t3": {
       "url": "https://your-t3-environment/mcp"
     },
     "validation": [
       { "name": "test", "argv": ["pnpm", "test"], "timeoutMs": 300000 },
       { "name": "build", "argv": ["pnpm", "run", "build"], "timeoutMs": 300000 }
     ],
     "maxRevisions": 2,
     "baseBranch": "main",
     "remote": "origin"
   }
   ```

4. Commit the configuration and feature documents to Git.

Validation requirements:

- Configure at least one validation command.
- Give each command a different name.
- Supply each command as an argument array.
- Use commands that stop when their work is complete.
- Do not use commands that start background processes.
- Make sure that `PATH` selects the required runtime, or specify an absolute executable path.
- For shell pipelines, use a script tracked in the repository as the command.

flow runs validation commands directly in the implementation worktree, without a shell. The commands inherit the environment of the flow process. T3 project setup scripts can install dependencies when T3 creates the worktree.

Optional T3 settings:

- Set `t3.projectId` to select a specific registered project.
- Set `t3.modelSelection` to `{ "instanceId": "...", "model": "..." }` to select a model.
- Use provider and model IDs from the current T3 catalog.

Without a model selection, T3 uses the project's default model. One model can implement and review a feature. Each review uses a new, independent conversation.

Approval records and jobs stay on the local machine. Each job saves a copy of its configuration and approved document. Configuration changes do not change an active job's workflow settings.

For connection recovery, you can correct the connection URL. flow still checks the saved project identity.

## Create and run a feature

For an interactive menu, run `flow` without arguments.

- Select actions by number or name.
- Select features by number. You do not need to remember IDs.
- Enter `q` at a selection menu to go back. Enter `q` at the main menu to exit.
- After each action, flow returns to the main menu.
- Read-only actions do not hold the runner's process claim.

Interactive commands:

- `flow init`: Create missing files and configure the connection and validation commands.
- `flow new`: Select Codex or Claude, then enter a prompt or select a saved request.
- `flow ready`: Select a document, read its content, and confirm approval.
- `flow run`: Select an approved feature and choose whether to follow progress or return.
- `flow resume`: Select a job and choose how to continue or recover it.
- `flow status`: Show all features, blockers, review results, validation results, and next steps.
- `flow list`: Show a compact feature list.
- `flow cancel`: Select a job and confirm cancellation. Stop its T3 threads first.
- `flow export`: Print roadmap JSON. No format flag is required.

Script behavior:

- Feature IDs and existing flags remain available.
- Commands do not prompt when standard input is not a terminal.
- `ready`, `run`, `resume`, and `cancel` require an explicit feature ID in scripts.
- `status` returns JSON in scripts. Use `--json` to request JSON in a terminal.
- `export --json` remains supported.
- Setup initializes default files in scripts. Configure required validation before execution.

For example, in a repository directory named `chat-app`:

1. Start feature creation:

   ```sh
   flow new
   ```

2. Select Codex or Claude.
3. Enter the feature description, such as “Export a conversation as Markdown.”
4. Wait for the draft to finish.
5. Edit `features/chat-app.md` and resolve its open questions.
6. Approve the current document:

   ```sh
   flow ready
   ```

7. Start implementation:

   ```sh
   flow run
   ```

8. Check progress with `flow status`.
9. If necessary, run `flow resume` and select the job.

Feature ID rules:

- flow derives the ID from the primary repository directory name.
- It converts the name to kebab-case.
- It adds a number when an ID is already used: `chat-app-2`, `chat-app-3`, and so on.
- A subdirectory or linked worktree uses the primary repository name.
- Existing files, saved requests, and job history reserve their IDs.

Drafting behavior:

- Codex runs through `codex exec` with a read-only sandbox.
- Claude runs in print mode with only Read, Glob, and Grep tools. Its MCP connections are disabled for this call.
- The request passes through standard input, without shell interpolation.
- The agent records material questions under Open questions. It does not ask them in T3.
- flow validates the generated document and always saves it as `draft`.
- A drafting call has a 15-minute timeout.

To recover an unfinished draft:

1. Run `flow new` again.
2. Select the saved request, or select `new` to create another feature.
3. If the previous attempt failed or stopped, confirm that its agent process has stopped before retrying.
4. Select the provider for the retry. flow reuses the saved description.

flow collects saved successful output without starting another agent. It keeps requests, attempt history, output, and returned session IDs in `.flow/state.sqlite`.

For old T3 draft requests, stop or finish the old T3 thread before confirming a retry. flow retains the original request and thread handle.

Optional scripting flags remain available:

- Use `flow new --provider codex --prompt "..."` to avoid interactive questions. The ID is still automatic.
- Use `--stdin` instead of `--prompt` to read a description from standard input.
- Use `--id <id>` to select an explicit ID or saved request.
- Use `--id <id> --retry-draft` only after confirming that the prior process has stopped.
- You can also write the Markdown document yourself.

Execution behavior:

- In a terminal, `run` and `resume` ask whether to follow progress for up to 15 minutes or return after one advance.
- In scripts, they return when an agent is still running unless you supply `--wait`.
- Use `--wait` or `--no-wait` to skip the progress prompt.
- Closing flow does not stop T3.
- flow supplies `t3-thread://` links for questions, approvals, and blocked runs.
- Only one feature can execute in a repository, including its worktrees.

Exit codes:

- `0`: The command completed. An agent can still be running.
- `1`: A command or setup operation failed.
- `2`: A job failed or needs attention.

Before implementation, flow fetches the configured remote base branch. T3 creates a worktree from that exact commit on a unique `flow/...` branch. flow supplies the approved feature document separately.

The new worktree does not include uncommitted changes from your checkout. flow does not change your checkout during implementation.

## Write feature documents

Store each document directly in `features/` with a `.md` extension. See the [example feature](../examples/export-conversation.md).

Use only these YAML frontmatter fields:

```yaml
---
id: export-conversation
status: draft
group: conversations
depends_on: []
---
```

Frontmatter requirements:

- Give each feature a unique ID in kebab-case.
- Keep the ID unchanged after creation.
- Set `status` to `draft`, `ready`, or `cancelled`.
- Use `group` only for organization. This field is optional.
- Put prerequisite feature IDs in `depends_on`.
- Do not create dependency cycles.
- Make sure that each dependency refers to an existing feature.

The `status` field records human intent. flow stores execution progress separately. A group does not create an execution dependency.

Document requirements:

- Include a title.
- Include the sections Outcome, Requirements, Acceptance criteria, Out of scope, and Open questions.
- Give specific information in Outcome, Requirements, and Acceptance criteria.
- Write each acceptance criterion as a single bullet or a separate paragraph.
- Record unresolved decisions in Open questions.

Implementation evidence must refer to each acceptance criterion exactly. Automatic validation checks document structure and placeholder content. Human approval is still necessary to check the meaning and quality.

## Approve a feature

1. Review the document's current content.
2. Run `flow ready` and select the feature.
3. If flow displays open questions, resolve them or explicitly accept them.
4. Confirm approval when flow asks.

For scripts:

- Supply `--yes` to approve the current content.
- Also supply `--accept-questions` to accept unresolved questions.

flow records approval for the exact document bytes. A statement in the document that says it is ready does not approve it.

Any byte change requires approval before a new run. An active job uses its saved approved document. Later document edits do not change that job's scope.

Dependency rules:

- A prerequisite is complete only when GitHub CLI confirms that its implementation PR is merged.
- An open or closed PR does not satisfy a dependency.
- If flow cannot check the PR status, it blocks execution.
- flow does not create dependent branches or PR stacks.
- A feature with an implementation PR cannot start another run.
- Use a new feature ID for additional scope.

## Workflow and saved state

The usual stage sequence is:

1. `preparing`
2. `implementing`
3. `reviewing`
4. `revising`, if the reviewer requires changes
5. `reviewing`, after each revision
6. `validating`
7. `publishing`
8. `pr_open`

A failed, blocked, or cancelled job retains its stage for recovery. `pr_open` means that a PR exists. The feature is delivered only after the PR is merged. `status` and JSON export check the current merge status.

Before publication, flow requires:

- Valid JSON evidence for every acceptance criterion.
- A passing structured result from an independent reviewer.
- Successful validation commands for the exact candidate Git tree.

flow stages files in the dedicated worktree to identify the candidate Git tree. Completion of an agent turn alone does not satisfy these requirements.

Review rules:

- The reviewer must not modify files.
- Changes to the candidate tree during review invalidate the review.
- A malformed result or failed review cannot pass.
- Each later review receives the previous findings and implementation responses.
- By default, unresolved findings after two automatic revisions require human input.

The SQLite database in `.flow/` stores:

- The approved document and its hash.
- The job stage and outcome.
- Thread and run identifiers.
- The workspace binding and candidate Git trees.
- Review history and validation results.
- Publication progress and the PR URL.

SQLite uses write-ahead logging and full synchronous writes. A database process claim prevents simultaneous flow runners. flow releases a stale claim when its local process no longer exists.

flow retains claims for live or reused process IDs. It also retains claims from other hosts.

State requirements:

- Do not share `.flow/` between hosts.
- Back up `.flow/` if you need to keep local approvals and job history.
- Do not delete state to recover a job. Deletion removes the identifiers needed for recovery.

## Recover a job

### Questions, approvals, or failed agent turns

1. Open the supplied T3 thread link.
2. Answer the question, give the approval, or correct the failed turn in T3.
3. Run `flow resume`, select the job, and select Continue.

### Changes or an invalid review

Use this procedure after manual fixes, a malformed review, validation changes, or the maximum number of automatic revisions.

1. Inspect the implementation worktree.
2. Correct the problem.
3. Run `flow resume`, select the job, and select Review and validate again.

For scripts, use `flow resume <id> --recheck`.

This command requires a new independent review and validation. It does not bypass review or reset the automatic revision limit.

### Interrupted validation

1. Make sure that the validation subprocesses have stopped.
2. Run `flow resume` and select the job.
3. Confirm that the validation processes have stopped.
4. Request a fresh review if files changed.

For scripts, use `flow resume <id> --retry-validation`. Include `--recheck` if files changed.

flow does not automatically repeat validation when the previous execution outcome is unknown.

### Missing launch response

flow searches T3 for the saved unique thread title. If it cannot find a matching thread, it stops.

1. Inspect T3 for the thread.
2. Make sure that the launch did not create a thread.
3. Run `flow resume`, select the job, and select Retry a launch.
4. Confirm that no thread exists.

For scripts, use `flow resume <id> --retry-launch` after the same checks.

Do not rename a flow-managed thread before flow has identified the launch outcome.

### Interrupted PR creation

flow checks the local commit, remote branch, and existing PRs before it continues publication.

1. Inspect GitHub if flow cannot find a PR after a missing creation response.
2. Make sure that no PR exists for the feature branch.
3. Run `flow resume`, select the job, and select Retry PR creation.
4. Confirm that no PR exists.

For scripts, use `flow resume <id> --retry-publish` after the same checks.

Publication recovery rules:

- Resolve mismatched PRs or remote branches manually. flow never force-pushes.
- After a push or PR creation attempt, do not use `--recheck` to overwrite the candidate.
- If T3 linking fails, use `flow resume <id>` to retry the link. flow retains the PR URL.

### Cancel a job

1. Stop the active threads in T3.
2. Identify the outcomes of any incomplete operations.
3. Run `flow cancel`, select the job, and confirm cancellation.

Cancellation releases the local feature claim. It preserves all files and worktrees. flow does not perform destructive cleanup.

The Markdown status `cancelled` prevents new execution. It does not stop a job that already uses an approved document copy.

## Export JSON

1. Export the roadmap data:

   ```sh
   flow export > roadmap.json
   ```

2. Use the versioned JSON file as input for a roadmap tool.

The export contains:

- Sorted feature IDs, dependencies, titles, and groups.
- Document readiness and approval match.
- Execution stages and outcomes.
- Dependency blockers.
- Review and validation summaries.
- Thread links and PR URLs.
- Delivery state.

The export excludes:

- Configuration and credentials.
- Raw logs and document bodies.
- Absolute worktree paths.
- Graph layout and color fields.

The output stays the same when documents, job state, and GitHub status stay the same.

## v0 limits

Operating requirements:

- Use trusted repository scripts.
- Use agents that follow the supplied instructions.
- Do not edit the worktree while an agent or flow command uses it.

The reviewer receives read-only instructions, but the operating system does not enforce them. flow detects candidate changes around review, validation, and publication. It cannot prevent simultaneous edits by external processes.

Diffs and tool outputs above the 8 MB limit cause failure. flow does not silently truncate them.

Unsupported features:

- Bare repositories and submodules.
- Filesystems accessible only on a remote machine.
- Automatic merging.
- Directory watchers and background daemons.
- Scheduling and parallel feature execution.
- PR stacks.
- Standalone Codex and Claude execution adapters for implementation and review.
