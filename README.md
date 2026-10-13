# Claude Codex Subagents

Full-access fork of [SSS135/claude-code-codex-plugin](https://github.com/SSS135/claude-code-codex-plugin), based on version 0.2.3, commit `229137b3a8f6c21bbea653387f0e9ba909214b81`. Original copyright and MIT license are preserved.

Claude delegates through its native `Agent` tool to `codex:sol`, `codex:luna`, `codex:astra`, or `codex:terra`. Codex runs the task through `codex app-server`, while a native background subagent provides the task list entry, completion notification, messaging, and cancellation.

## Fixed execution policy

Every new thread, resumed thread, and follow-up turn uses:

```json
{
  "sandbox": "danger-full-access",
  "approvalPolicy": "never",
  "approvalsReviewer": "user"
}
```

The turn-level equivalent is `sandboxPolicy: { "type": "dangerFullAccess" }`. There is no Codex sandbox and no approval reviewer is invoked for command escalation. Codex acts with the permissions of the operating-system account running it.

This policy is enforced, not merely a default. Old `sandbox:` and `approvals:` prompt headers are validated and stripped for compatibility but cannot change it. Old project or installed plugin permission settings cannot change it either. Existing saved jobs are normalized to full access when restored. An unexpected approval request is declined without a dialog; the plugin does not bypass a restriction imposed by the Codex server or managed configuration.

## Install

Requirements: Claude Code CLI 2.1.287 or later with mods enabled, Codex CLI with `app-server`, Node 18+, macOS or Linux, and an authenticated Codex installation.

Install from GitHub through the plugin marketplace:

```sh
claude plugin marketplace add ank1015/claude-codex-subagents
claude plugin install codex@codex-full-access
```

Or clone and load the plugin for one Claude session:

```sh
git clone https://github.com/ank1015/claude-codex-subagents.git
claude --plugin-dir ./claude-codex-subagents
```

For a local ZIP upload, archive the repository contents with `.claude-plugin/plugin.json` at the archive root. Codex CLI and Node must be installed on the machine running Claude Code.

Enable one version of the `codex` plugin in a session. If the upstream plugin is already installed, disable that version before using the fork.

Ask Claude: “Use codex:sol to implement the change and run its tests.” `SendMessage` steers a running turn or continues the same Codex thread after completion. `TaskStop` interrupts the Codex turn. Codex can send questions or interim findings back through its `claude_session.message_claude` tool.

## Models and effort

| Agent | Model | Default effort |
| --- | --- | --- |
| `codex:sol` | `gpt-6.1-sol` | high |
| `codex:luna` | `gpt-6-luna` | max |
| `codex:astra` | `gpt-6-astra` | high |
| `codex:terra` | `gpt-5.6-terra` | high |

Use an `effort:` header to override effort for one task. Otherwise the nearest `.claude/codex.json` effort wins over the plugin's `defaultEffort`, followed by the per-model default. Model and effort availability are checked through Codex's `model/list`.

```json
{ "effort": "medium" }
```

The plugin configuration also accepts `codexPath` and `nodePath`; missing configured binaries fall back to PATH. The original macOS path defaults are retained.

## Fixes in this fork

- Saved registries use separate `agents:<Claude session id>` keys. Writes are serialized and use the latest state.
- Legacy registries migrate only jobs owned by the current session. The shared legacy key is left untouched for other sessions.
- Recovery, process-exit handling, result lookup, and the running-jobs display operate on the current session's jobs.
- `/clear`, `/resume`, and `/branch` reload saved state. Switching session identity shuts down the old bridge and clears its caches; stale relay events cannot mutate the replacement session.
- The wrapper's `turn.step` error handler ends with an explicit failure instead of making a Haiku request.
- Approval text helpers preserve complete command and permission details.

## Tools and limits

`codex_list` lists this session's latest 10 jobs. `codex_result(id, full)` reads a job in this session; `full` includes its command/file/message digest. `codex_await` is internal to wrapper agents.

A job starts a new Codex thread; this does not import existing Codex conversations or custom agent roles. Codex receives the delegation prompt, its own configuration and project instructions, and the messaging instructions. It does not receive the Claude conversation automatically.

The wrapper names Haiku as its metadata model but does not call it. Claude Desktop’s task panel counts wrapper usage and tool calls, so its model label and counters do not show Codex’s execution. A pending `codex_await` has also been observed displaying as interrupted even though the same call later returned successfully; check `codex_list` and `codex_result` for the Codex job state. The parent Claude conversation still consumes Claude usage. Native auto-mode handback may show the classifier-unavailable note because Codex executes outside Claude's classifier. Final messages retain the upstream 20,000-character limit, digests retain 60 entries, and each session retains at most 40 jobs. Claude's plugin store has a shared 4 MiB limit. Very large outputs should be written to files by Codex.

The bridge uses a private Unix socket and an app-server process per Claude session. Native mod APIs and the Codex app-server protocol can change between versions. The original implementation is credited to [SSS135](https://github.com/SSS135/claude-code-codex-plugin); this repository maintains the full-access changes.

## Validation

```sh
claude plugin validate .
claude plugin test .
node --test tests/bridge.test.mjs
```

The plugin tests use a fake app server and exercise orchestration without model calls. The bridge tests launch real bridge processes against a fake Codex executable. They do not require credentials. Live model and interactive UI behavior need a separate smoke test after loading the plugin.
