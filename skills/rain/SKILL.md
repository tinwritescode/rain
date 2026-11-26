---
name: rain
description: >
  Calm-senior backend mode: flat, explicit, boring code that stays correct when
  two requests land at once. Use when writing, changing or reviewing backend
  code (services, controllers, DTOs, entities, migrations, webhooks, third-party
  integrations), and when the user says "rain", "rAIn" or "clean code".
argument-hint: "[review [base]|off]"
license: MIT
---

# rAIn

You write backend code a tired teammate reads at 2am and trusts. Boring beats clever. Every value has an obvious origin, every write is safe under concurrency, every external system has a local mirror.

Active for the session until the user says "stop rain" or "normal mode". `/rain review` applies these rules to a diff (see Review mode).

The codebase's own conventions win; these rules fill the gaps. When the project is TypeScript with NestJS (or another decorator/DI backend), also read [nestjs.md](nestjs.md) before writing code.

## Shape

- **Feature folders, layer subfolders.** Each feature holds `controllers/`, `services/`, `dtos/`, `entities/`, `enums/`, `repositories/`. File names carry their kind: `task.entity.ts`, `task-status.enum.ts`, `task.service.ts`.
- **Audience in the name.** Name an endpoint group by its caller: `internal.task.controller.ts`, class `InternalTaskController`, route `internal/task`, guard on the class. Public, internal and webhook routes live under distinct prefixes (`/internal/...`, `/webhook/:provider`) so infra can allowlist by path.
- **One file per endpoint contract.** One endpoint's params, body and response DTOs share a file: `internal-task-close-request.dto.ts` holds `InternalTaskCloseRequestParamsDto`, `InternalTaskCloseRequestBodyDto`, `InternalTaskCloseResponseBodyDto`.
- **Thin controllers.** Validate through the DTO, map each DTO field to a service option by name (rename `member_id` to `memberId` here, at the boundary), call one service method, return it.
- **Minimal abstraction.** Repetition stays until two callers genuinely change together. Reach for the library already in the stack before adding one that does the same job.

## Functions

- **Options objects grouped by concern.** `assign(taskOpts, memberOpts)`, `close(taskRef, memberOpts, { notify, reason })`. Type them inline at the signature unless reused.
- **Guard clauses, one line each.** `if (task === null) throw new NotFoundException('Task Not Found');` then the happy path, unindented. Use `=== null` / `=== undefined` on values from the DB or the network.
- **Explicit switch on variants.** `switch` on provider, kind or event type; every handled case spelled out; `default` throws `'Unsupported Provider'`. For a provider's event catalogue, list the known events, group the ignored ones under `// NOTE: Not needed yet` and fall through to a logged default: the switch is the record of what was considered.
- **Named constants beside their use.** `const MAX_TITLE_LENGTH = 200;`. Underscored numerals for units: `30_000` (ms), `10_000` (rows).
- **Responses built by hand.** Map each field into a fresh object literal: optional values `?? null`, lists `?? []`, dates `.toISOString()`, the public uuid as `id`.

## Data

- **Two ids.** Internal `bigint` primary key for joins; a separate `uuid` for everything that leaves the service (responses, remote metadata, logs).
- **Owner by reference.** A row owned by another service stores `refId` + `refType` (enum), unique together. Cross-service links stay references, never foreign keys.
- **Timestamps on every table.** `createdAt` and `updatedAt` default `NOW()` in the DB; `updatedAt` refreshed on update.
- **Append-only status enums.** UPPER_CASE keys, snake_case values, headed by `// WARNING: Append only. Never rename or remove a value; mark retired ones deprecated.` Planned members sit as commented lines so the roadmap is visible.
- **Generated migrations.** Schema changes come from the ORM's generator, with its snapshot, in their own commit (see Commits).

## Writes under concurrency

- **One transaction per use case.** Every writing service method runs in one `transactional` block. Helpers take an optional `em` and fall back: `const em = opts.em ?? this.entityManager;`.
- **Lock the owner, then recheck.** Take a pessimistic write lock on the aggregate that owns the change (workspace, member) first. After the lock, refresh the row and re-read its status; return early when another request already moved it.
- **Idempotent transitions.** Every state change first checks the current state and returns when the target is already reached. Running a handler twice changes nothing.
- **Duplicates checked inside the lock.** "Member already has a pending invite" is a status-filtered `findOne` inside the locked transaction, throwing `BadRequestException` that names the existing record's status and uuid.

## External systems

- **Local mirror.** Each remote object you depend on gets a table: unique `remoteId`, a human `name` key, `raw` JSON of the last payload, timestamps. Read the mirror first.
- **Upsert with `??=`.** `let local = await find(...); local ??= new Mirror(); local.name = remote.name; local.raw = remote; em.persist(local);`. Sync jobs walk the remote list and run this per item, matching on remote id or name.
- **Find-or-create.** Mirror hit: return it. Else search the remote by your metadata (`refId`, `refType`) and adopt the match. Else create it, with your ids in its metadata.
- **Correlate through metadata.** Stamp your uuid (`taskRef`) into the remote object (metadata, a label, a body marker); webhook handlers resolve back through it.
- **Webhooks.** Verify the signature, persist the event keyed by the provider's delivery id, dispatch, store the related object on the event row. Drop stale events: `if (isBefore(eventTimestamp, local.updatedAt)) return;`. Keep `replayEvent(id)` that re-dispatches a stored event. The provider is the source of truth: verify the signature, trust the payload's meaning.

## Config and boundaries

- **Env validated at boot.** One class declares every required env var with validators; startup fails listing every violation at once.
- **Config per module.** Each module registers its own namespaced config beside it and injects it typed. SDK clients are module providers built by a factory from that config and injected by class token.
- **Constant-time secrets.** Compare API keys with a timing-safe compare; on a length mismatch, still run a same-length compare before rejecting.
- **Validation at the edge.** A global validation pipe with `whitelist` and `transform`. Field defaults (`notify: boolean = true`) live on the DTO.
- **Unauthenticated health route.** `GET /healthz` returns `{ status: 'ok' }`, commented with who calls it.

## Comments

One line, prefixed by intent:

- `// TODO: <what> (<phase or ticket>)`: the known next step.
- `// NOTE: <why>`: a decision a reader would question.
- `// WARNING: <invariant>`: a rule that breaks things when ignored.
- `// Reference: <url>`: where a borrowed pattern came from.

An unprefixed comment names who depends on the code: `// Load balancer probe. Public on purpose.`

## Commits

- Ticket work: `<TICKET>: <Title Case Summary>`. Otherwise `Chore:`, `Fix:`, `Task:` or `Setup:` plus a Title Case summary.
- Generated migrations follow the feature commit as `<TICKET>: <Title> (Migration)`.
- Convention-only cleanups ship alone as `Chore: <Area> Update (Convention)`.
- Branches: `feature/<TICKET>.<short-name>`.

## Review mode

`/rain review [base]` (base defaults to the merge-base with the default branch): read the diff and every function it touches, then walk each section above against each changed file. Report every violation as `file:line | rule | fix`, ordered concurrency and webhooks first, naming and comments last. Done when every section has a verdict, including the clean ones (`Writes under concurrency: clean`).
