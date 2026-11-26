# Examples

Each task below ran twice: once without rAIn and once with it. Both runs used the same small NestJS + MikroORM task-tracker API ([`fixture/`](fixture)), the same prompt and the same model (Claude Opus 5.5 as a Claude Code subagent), one run each. The only difference was that the rAIn run started with "read `SKILL.md` and `nestjs.md` and follow them".

These are real, unedited diffs, not a benchmark. One run per arm proves nothing statistically. The point is to show what changes.

| Task | Without rAIn | With rAIn |
|---|---|---|
| [GitHub webhook](#1-github-webhook): PR merged, task done, assignee's count +1 | [97 lines, 4 files](webhook/without-rain.diff) | [291 lines, 12 files](webhook/with-rain.diff) |
| [Internal close endpoint](#2-internal-close-endpoint) for the HR service | [66 lines, 4 files](close/without-rain.diff) | [137 lines, 8 files](close/with-rain.diff) |
| [GitHub repository + label sync](#3-github-repository--label-sync) | [155 lines, 6 files](sync/without-rain.diff) | [258 lines, 11 files](sync/with-rain.diff) |
| [`/rain review`](review/close-without-rain.md) of the close diff without rAIn | | 11 findings, 3 of them real bugs |

## The fixture

Two entities and nothing else: `Member` (`externalId` from the HR service, `githubLogin`, `completedTasks`) and `Task` (`title`, `assignee`, `status` of `open` / `done` / `closed`, and `githubPullRequest` as `"owner/repo#123"`).

## 1. GitHub webhook

> GitHub sends us `pull_request` webhooks. When a pull request linked to a task is merged, mark the task done and increment the assignee's `completedTasks`. Add the webhook endpoint.

The run without rAIn was already correct and compact. It used a conditional `UPDATE ... WHERE status = 'open'` and incremented the counter in SQL, so a redelivery cannot count twice. rAIn reached the same safety with row locks and added what you need after an incident:

| | Without | With |
|---|---|---|
| Redelivery counts twice | No (conditional update) | No (`FOR UPDATE` on tasks, then on the member) |
| Delivery stored, keyed by `X-GitHub-Delivery` | No | Yes, `WebhookDelivery` with a unique key on `(provider, remoteId)` |
| Replay a past delivery after a bug fix | No | `replayEvent(id)` |
| Route | `/webhooks/github` | `/webhook/:provider`, so infra can allowlist one prefix |
| Other events and actions | One `if`, silently ignored | Listed under `// NOTE: Not needed yet`, logged |
| Signature check on a wrong-length header | Returns early | Same-length compare either way |
| Missing `GITHUB_WEBHOOK_SECRET` | Fails on the first webhook | Boot fails |

Cost: 3x the code.

## 2. Internal close endpoint

> When someone leaves the company, our HR service needs to close the open tasks assigned to them. Add an internal endpoint it can call to close one task. Only open tasks can be closed.

The difference that matters is a retry. The HR service times out and calls again.

Without rAIn ([`internal-tasks.service.ts`](close/without-rain.diff)) it gets `409`:

```ts
const task = await this.em.findOne(Task, { id: taskId, assignee: member.id }, { refresh: true });
if (!task) throw new NotFoundException('Task not found');
if (updated === 0) throw new ConflictException('Only open tasks can be closed');
return task;
```

With rAIn ([`task.service.ts`](close/with-rain.diff)) it gets `200`:

```ts
// NOTE: Already closed is success, so the HR service can retry safely.
if (task.status === TaskStatus.CLOSED) return { id: task.id, status: task.status };
if (task.status !== TaskStatus.OPEN) throw new BadRequestException(`Task Not Open: ${task.status}`);
```

rAIn also:

- answered `200` instead of Nest's default `201` for a `POST` that creates nothing,
- ran a same-length `timingSafeEqual` even when the key length is wrong,
- validated `INTERNAL_API_KEY` at boot,
- gave the endpoint a DTO file.

## 3. GitHub repository + label sync

> Add a service that syncs our GitHub org's repositories and their labels into our database so the app can look up a label by repository and name, plus a way to run that sync.

Both runs read everything from GitHub first, then write in one transaction, matching rows on GitHub ids so renames update in place. rAIn's version differs in four ways:

| | Without | With |
|---|---|---|
| Repo or label removed on GitHub | Row hard-deleted | `deletedAt` set; lookups skip it, history stays |
| Last GitHub payload | Not kept | `raw` JSON on every row |
| Two syncs at once | Race on the unique index | `pg_advisory_xact_lock` |
| GitHub client | `new Octokit()` inside the service | Module provider built from typed config |

rAIn also exposed the sync as `POST /internal/github/repository/sync` behind the API key guard. The run without rAIn used a standalone script. Either is fine.

## Reproduce

```bash
cp -R examples/fixture /tmp/tracker && cd /tmp/tracker
# Without: give your agent the task prompt above.
# With: prepend "Read skills/rain/SKILL.md and skills/rain/nestjs.md and follow them."
```
