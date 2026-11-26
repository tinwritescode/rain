# `/rain review` on the close task, without-rAIn version

Input: [`../close/without-rain.diff`](../close/without-rain.diff) against [`../fixture`](../fixture).
The output below is the reviewing agent's reply, unedited.

**Our own read of it:** findings 2, 3 and 6 are real bugs. A retry gets `409`, the guard leaks the key length, and the endpoint answers `201`. Finding 1 is overcautious, because the conditional `nativeUpdate` is already atomic. The rest are convention.

```
Findings, ordered concurrency first, naming and comments last:

src/tasks/internal-tasks.service.ts:12 | Writes under concurrency: one transaction per use case; lock the owner, then recheck | `nativeUpdate` and the `findOne` after it run in no transaction, and the owning Member is never locked. Wrap the method in `this.em.transactional(async (em) => ...)`. Inside it, load the Member by `externalId` with `LockMode.PESSIMISTIC_WRITE`, then load the task for that assignee, recheck `status` after the lock, and set it on the entity and flush. Do not use a bare `nativeUpdate` followed by a separate read.

src/tasks/internal-tasks.service.ts:26 | Idempotent transitions | A task that is already `CLOSED` throws `ConflictException`. When the HR service retries after a timeout, it gets a 409 for a close that succeeded. Return the task when `task.status === TaskStatus.CLOSED`. Throw only for other statuses that are not open (`DONE`).

src/common/guards/internal-api.guard.ts:19 | Constant-time secrets | `a.length !== b.length || !timingSafeEqual(a, b)` rejects a wrong-length key without running any compare, so response time reveals the key length. Always run `timingSafeEqual(a.length === b.length ? a : b, b)`, then reject on a length mismatch or a failed compare.

src/common/guards/internal-api.guard.ts:13 | Config and boundaries: env validated at boot; config per module | `INTERNAL_API_TOKEN` is read on each request, so a missing token only shows up when the HR service calls. Declare it in a boot-time env validation class passed to `ConfigModule.forRoot({ validate })`. Inject it as typed namespaced config (`registerAs`) instead of `ConfigService.get<string>`.

src/tasks/internal-tasks.service.ts:17 | Data: two ids; responses use the public uuid as `id` | The route and the response (`src/tasks/internal-tasks.controller.ts:18`, `id: task.id`) expose the internal integer primary key. Add a generated `uuid` column to `Task` (with its own migration commit). Key the route on it and return it as `id`.

src/tasks/internal-tasks.controller.ts:12 | NestJS controllers: a `POST` that does not create gets `@HttpCode(HttpStatus.OK)`; every handler declares its return type | The close endpoint currently answers `201 Created`. Add `@HttpCode(HttpStatus.OK)` and `Promise<InternalTaskCloseResponseBodyDto>`.

src/tasks/internal-tasks.controller.ts:14 | Shape: one file per endpoint contract; validation at the edge | Raw `@Param('externalId')` and `ParseIntPipe` skip the DTO. Add `dtos/internal-task-close-request.dto.ts` holding `InternalTaskCloseRequestParamsDto` (fields with `@IsNotEmpty()` `@IsString()` and so on) and `InternalTaskCloseResponseBodyDto`. Bind them with `@Param() params`.

src/tasks/internal-tasks.service.ts:12 | Functions: options objects grouped by concern | Positional `closeMemberTask(externalId, taskId)`. Use `close(taskOpts: { id: number }, memberOpts: { externalId: string })` and map the DTO fields by name in the controller.

src/tasks/internal-tasks.service.ts:14 | Functions: guard clauses use `=== null` on DB values | Use `if (member === null) throw new NotFoundException('Member Not Found');`. Apply the same at line 25 with `task === null` and `'Task Not Found'`.

src/tasks/internal-tasks.controller.ts:1 | Shape: feature folders with layer subfolders; audience in the name | Controller and service sit at the feature root with plural names. Move the controller to `src/tasks/controllers/internal.task.controller.ts` (`InternalTaskController`) and the service to `src/tasks/services/task.service.ts` (`TaskService`), and update `src/tasks/tasks.module.ts`.

src/tasks/internal-tasks.service.ts:16 | Comments: one line, prefixed by intent | Line 16 explains a decision, so it becomes `// NOTE: ...`. Remove line 11, which only restates the method. In `src/common/guards/internal-api.guard.ts:6-7`, keep the caller line and make the fail-closed line a `// WARNING: ...`.

Verdicts by section:
- Writes under concurrency: 2 violations (no transaction or owner lock; transition not idempotent).
- External systems: not applicable (no remote objects or webhooks in the diff).
- Config and boundaries: 2 violations (secret compare on length mismatch; token not validated at boot).
- Data: 1 violation (internal primary key exposed). Entities and enums are not changed by the diff.
- Functions: 2 violations (positional arguments; falsy guards). The hand-built response is clean.
- Shape: 3 violations (no DTO contract file; missing `@HttpCode` and return type; folder and file naming).
- Comments: 1 violation.
- Commits: not applicable (no git history).
```
