<p align="center">
  <img src="assets/logo.svg" width="360" alt="rAIn">
</p>

<p align="center">
  <em>He doesn't write clever code. He writes code that is still right at 2am.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Claude%20Code-plugin-2563eb?style=flat-square" alt="Claude Code plugin">
  <img src="https://img.shields.io/badge/works%20with-AGENTS.md-2563eb?style=flat-square" alt="Works with AGENTS.md">
  <img src="https://img.shields.io/badge/license-MIT-2563eb?style=flat-square" alt="MIT license">
  <a href="https://tinwritescode.github.io/rain/"><img src="https://img.shields.io/badge/docs-tinwritescode.github.io%2Frain-2563eb?style=flat-square" alt="Docs site"></a>
</p>

---

You know him. His PRs are boring. Nobody leaves comments on them. Two years later they have never paged anyone.

His webhook handler has seen the same delivery twice and counted it once. His internal endpoints answer a retry with `200`, not `409`. His services keep a local copy of every GitHub object they read, so a lookup never waits on a rate limit.

We couldn't clone him, so we cloned his habits. **rAIn puts him inside your AI agent.**

> Caveman makes your agent talk less. Ponytail makes it write less. **rAIn makes what it writes survive production.**

<!-- #region install -->
## Install

**Claude Code**

```text
/plugin marketplace add tinwritescode/rain
/plugin install rain@rain
```

**Codex, Cursor, Gemini CLI, or any agent that reads `AGENTS.md`:** copy [`AGENTS.md`](AGENTS.md) and [`skills/rain/`](skills/rain) into your repo.
<!-- #endregion install -->

<!-- #region before-after -->
## Before / after

Same model, same repo, same prompt. The only difference is rAIn. [Full diffs →](examples/)

> *When someone leaves the company, our HR service needs to close the open tasks assigned to them. Add an internal endpoint it can call to close one task.*

### Without rAIn

From [`examples/close/without-rain.diff`](examples/close/without-rain.diff) (`src/tasks/internal-tasks.service.ts`):

```ts
const member = await this.em.findOne(Member, { externalId });
if (!member) throw new NotFoundException('Member not found');

// Conditional update so a concurrent status change cannot be overwritten.
const updated = await this.em.nativeUpdate(
  Task,
  { id: taskId, assignee: member.id, status: TaskStatus.OPEN },
  { status: TaskStatus.CLOSED },
);

const task = await this.em.findOne(Task, { id: taskId, assignee: member.id }, { refresh: true });
if (!task) throw new NotFoundException('Task not found');
if (updated === 0) throw new ConflictException('Only open tasks can be closed');
return task;
```

**Retry after timeout → `409 Conflict`** (from a `201` endpoint) and someone gets paged.

### With rAIn

From [`examples/close/with-rain.diff`](examples/close/with-rain.diff) (`src/tasks/services/task.service.ts`):

```ts
const member = await this.lockMember(memberOpts, em);

// NOTE: Read the task after the member lock so a concurrent close sees the committed status.
const task = await em.findOne(Task, { id: taskOpts.id, assignee: member });
if (task === null) throw new NotFoundException('Task Not Found');

// NOTE: Already closed is success, so the HR service can retry safely.
if (task.status === TaskStatus.CLOSED) return { id: task.id, status: task.status };
if (task.status !== TaskStatus.OPEN) throw new BadRequestException(`Task Not Open: ${task.status}`);

task.status = TaskStatus.CLOSED;
await em.flush();

return { id: task.id, status: task.status };
```

**Retry after timeout → `200 OK`** with the same body as the first call.

Both excerpts are copied verbatim from the runs.

## What changes

Three tasks on the same task-tracker fixture, run once each way:

| Task | Lines (without → with) | What rAIn added |
|---|---|---|
| [GitHub webhook](examples/README.md#1-github-webhook) | [97](examples/webhook/without-rain.diff) → [291](examples/webhook/with-rain.diff) | Delivery log keyed by `X-GitHub-Delivery`, `replayEvent(id)`, `/webhook/:provider` route, boot fails on a missing secret |
| [Internal close endpoint](examples/README.md#2-internal-close-endpoint) | [66](examples/close/without-rain.diff) → [137](examples/close/with-rain.diff) | Idempotent retry, member lock, `200` instead of `201`, constant-time key check that also covers wrong lengths |
| [GitHub repository + label sync](examples/README.md#3-github-repository--label-sync) | [155](examples/sync/without-rain.diff) → [258](examples/sync/with-rain.diff) | Soft delete instead of hard delete, `raw` payload mirror, advisory lock against concurrent syncs |

**Trade-off:** It is not free. Every rAIn diff came out bigger — up to 3x for the webhook. The run without rAIn got the webhook right too, with less code. [The trade-offs are written up in `examples/`.](examples/README.md)
<!-- #endregion before-after -->

## `/rain review`

Point it at a branch. It reads the diff and every function the diff touches, checks each rule section, and lists concurrency bugs first.

Run on the without-rAIn close diff, `/rain review` returned **11 findings — 3 real bugs**, 1 overcautious warning (finding 1, because the conditional `nativeUpdate` is already atomic), and 7 convention items:

| Location | Rule | Bug caught |
|---|---|---|
| `internal-tasks.service.ts:26` | Idempotent transitions | Closing an already-`CLOSED` task throws `ConflictException` (`409`) on retry |
| `internal-api.guard.ts:19` | Constant-time secrets | Short-circuits on length mismatch before `timingSafeEqual`, revealing key length |
| `internal-tasks.controller.ts:12` | NestJS controllers | `POST` that does not create answers `201 Created` instead of `200 OK` |

[Full review, with our notes on which findings are real →](examples/review/close-without-rain.md)

## What it teaches

| Area | Rules |
|---|---|
| **Shape** | Feature folders with layer subfolders. One verb per service (`TaskCloserService`). Caller audience in the name (`internal.task.controller.ts`). Remote clients in `connectors/`. One DTO file per endpoint. Thin controllers. |
| **Functions** | Options grouped by concern. One-line guard clauses. Explicit `switch` with a `default` that throws. Named constants. Responses built by hand. |
| **Data** | `bigint` id inside, `uuid` outside. `refId` + `refType` for rows owned by other services. Unset is `NULL`. Append-only status enums. One squashed, generated migration per change. |
| **Reads** | Filter, sort and count in the query. One query per batch. Empty lists answer `[]`. |
| **Concurrency** | Guard the double-click. One transaction per use case, its handle passed to every helper. Lock the owner, then refresh and recheck. Idempotent transitions. Atomic cache counters and locks. |
| **External systems** | Local mirror with the `raw` payload. Upsert with `??=`. Find-or-create through metadata. Webhooks and queue consumers that skip what they already processed. Totals that self-correct. A sync endpoint for drift. |
| **Caching** | Permissions read live. Keys scoped by tenant. Invalidate on the event, TTL as the fallback. |
| **Errors & numbers** | Client mistakes are 4xx. Catch what you name. Decimals for money, `COALESCE` in SQL sums, client time clamped to server now. |
| **Boundaries** | Env validated at boot. Config per module. Reject bad input instead of repairing it; bound every array and string. Timing-safe secret compares. `/healthz` outside auth. |
| **Comments & commits** | `TODO:` / `NOTE:` / `WARNING:` / `Reference:`. `TICKET-123: Title Case`, with a separate `(Migration)` commit and review fixes squashed in. |

The rules are framework-agnostic ([`SKILL.md`](skills/rain/SKILL.md)). Concrete NestJS + MikroORM forms are in [`nestjs.md`](skills/rain/nestjs.md), which the agent loads only on NestJS projects. Your repo's own conventions always win.

## Use

It turns itself on for backend work. You can also say "rain".

```text
/rain                  # on for this session
/rain review           # review this branch against the default branch
/rain review main~3    # review against a specific base
stop rain              # off
```

## FAQ

**Only for NestJS?**
No. The core rules apply to any backend. NestJS has the extra concrete file today. PRs for Django, Rails, Go and Spring are welcome.

**Does it fight [ponytail](https://github.com/DietrichGebert/ponytail)?**
They pair. Ponytail decides how little to write. rAIn decides how to write it. When they disagree, it is usually because rAIn wants an idempotency check or an event log. For code that other services retry against, rAIn should win.

**Benchmarks?**
Not yet. We would rather show three real diffs than a made-up chart.

## Contributing

A new rule has to come from a real incident or a real review comment. Open an issue with the bug the rule would have prevented.

## License

MIT
