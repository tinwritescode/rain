---
name: rain
description: >
  Calm-senior backend mode: flat, explicit, boring code that stays correct when
  two requests land at once. Use when writing, changing or reviewing backend
  code (services, controllers, DTOs, entities, migrations, webhooks, queue
  consumers, third-party integrations), and when the user says "rain", "rAIn"
  or "clean code".
argument-hint: "[review [base]|off]"
license: MIT
---

# rAIn

You write backend code a tired teammate reads at 2am and trusts. Boring beats clever. Every value has an obvious origin, every write is safe under concurrency, every external system has a local mirror.

Active for the session until the user says "stop rain" or "normal mode". `/rain review` applies these rules to a diff (see Review mode).

The codebase's own conventions win; these rules fill the gaps. When the project is TypeScript with NestJS (or another decorator/DI backend), also read [nestjs.md](nestjs.md) before writing code.

## Shape

- **Feature folders, layer subfolders.** Each feature holds `controllers/`, `services/`, `dtos/`, `entities/`, `enums/`, `repositories/`. File names carry their kind: `task.entity.ts`, `task-status.enum.ts`, `task.service.ts`. One enum, type or interface per file, named after what it holds.
- **One verb per service.** Split a resource's use cases into services named by verb: `TaskCreatorService`, `TaskFetcherService`, `TaskCloserService`, `RepositorySyncService`. A catch-all `<Resource>Service` grows until nobody reads it. A helper with no dependencies stays a plain exported function, not an injectable.
- **Audience in the name.** Name an endpoint group by its caller: `internal.task.controller.ts`, class `InternalTaskController`, route `internal/task`, guard on the class. Public, internal and webhook routes live under distinct prefixes (`/internal/...`, `/webhook/:provider`) so infra can allowlist by path.
- **Clients of other services live in `connectors/`.** One client class per remote API namespace; the class names the namespace and the method spells the path: `TaskInternalApiService.closeForMember` calls `task/internal/close/for-member`.
- **Routes say what they do.** `POST /<noun>` creates that noun and returns it; an update is `PATCH /<noun>/:id`; a nested create names its noun (`POST internal/workspace/:id/label`). A `POST` that creates nothing (a sync, a close) answers `200`.
- **One file per endpoint contract.** One endpoint's params, body and response DTOs share a file: `internal-task-close-request.dto.ts` holds `InternalTaskCloseRequestParamsDto`, `InternalTaskCloseRequestBodyDto`, `InternalTaskCloseResponseBodyDto`. A shape shared by every endpoint (a generic HTTP envelope) is named for what it is, not for the first endpoint that used it.
- **Thin controllers.** Validate through the DTO, map each DTO field to a service option by name (rename `member_id` to `memberId` here, at the boundary), call one service method, return it.
- **Minimal abstraction.** Repetition stays until two callers genuinely change together. Reach for the library already in the stack (`compact`, `max`, `sample`, date helpers) before hand-rolling or adding one that does the same job.

## Functions

- **Options objects grouped by concern.** `assign(taskOpts, memberOpts)`, `close(taskRef, memberOpts, { notify, reason })`. Type them inline at the signature unless reused.
- **Guard clauses, one line each.** `if (task === null) throw new NotFoundException('Task Not Found');` then the happy path, unindented. Use `=== null` / `=== undefined` on values from the DB or the network.
- **Explicit switch on variants.** `switch` on provider, kind or event type; every handled case spelled out; `default` throws `'Unsupported Provider'`. For a provider's event catalogue, list the known events, group the ignored ones under `// NOTE: Not needed yet` and fall through to a logged default: the switch is the record of what was considered.
- **Named constants beside their use.** `const MAX_TITLE_LENGTH = 200;`, `const MIN_ESTIMATE_HOURS = 1;`. Underscored numerals for units: `30_000` (ms), `10_000` (rows). Durations through named helpers: `minutesToMilliseconds(5)`.
- **Names say exactly which thing.** `memberTaskEvents`, not `taskEvents`, when both entities exist. An `OrThrow` / `OrFail` suffix only beside a twin that returns `null`.
- **Responses built by hand.** Map each field into a fresh object literal: optional values `?? null`, lists `?? []`, dates `.toISOString()`, the public uuid as `id`.

## Data

- **Two ids.** Internal `bigint` primary key for joins; a separate `uuid` for everything that leaves the service (responses, remote metadata, logs).
- **Owner by reference.** A row owned by another service stores `refId` + `refType` (enum), unique together. Cross-service links stay references, never foreign keys.
- **Timestamps on every table.** `createdAt` and `updatedAt` default `NOW()` in the DB; `updatedAt` refreshed on update.
- **Unset is `NULL`.** An optional column with no value holds `NULL`, never `''` or `0`, so "not set" is one query.
- **Append-only status enums.** UPPER_CASE keys, snake_case values, headed by `// WARNING: Append only. Never rename or remove a value; mark retired ones deprecated.` Planned members sit as commented lines so the roadmap is visible.
- **Indexes earn their place.** Index what a query filters, joins or sorts on. A unique constraint is already an index.
- **One migration per change.** Schema changes come from the ORM's generator, with its snapshot, in their own commit (see Commits). Review iterations are regenerated into one final migration before merge; a column added then dropped never ships. A data backfill is hand-written SQL inside that same migration. Every migration keeps its `down`.

## Reads

- **Filter, sort and count in the query.** A `.filter` after the query breaks pagination (page 1 can come back empty), and the `total` uses the same filter as the page.
- **One query per batch.** Load the rows for a whole list in one `IN` query, never a lookup per row. Generating unique codes: make ten candidates, check them in one query, keep an unused one.
- **Collections answer `[]`.** A list endpoint with no rows returns an empty array, never `404`.

## Writes under concurrency

- **Guard the double-click.** Design every write for the same request arriving twice at once: a double click, a client retry, two tabs. Spend guards there, not on the database or cache being down (when those die, everything dies).
- **One transaction per use case.** Every writing service method runs in one `transactional` block. Every read and write inside it, in every helper, goes through the transaction's handle: helpers take an optional `em` and fall back, `const em = opts.em ?? this.entityManager;`. A helper on the default handle opens a second connection that reads stale rows and commits on its own.
- **Lock the owner, then recheck.** Take a pessimistic write lock on the aggregate that owns the change (workspace, member) first. After the lock, refresh the row and re-read its status; return early when another request already moved it.
- **Idempotent transitions.** Every state change first checks the current state and returns when the target is already reached. Running a handler twice changes nothing.
- **Uniqueness checked twice.** Inside the locked transaction, a status-filtered `findOne` throws `BadRequestException` that names the conflict ("Member already has a pending invite", with its status and uuid). The DB unique constraint stays as the backstop.
- **Atomic in the store.** A counter, rate limit or lock in a cache is one atomic command, never read-then-write: `SET key 0 NX EX 60` then `INCR key`; a lock is `SET key <uuid> NX PX <ms>`, then read it back and compare. Two callers that both `INCR` then both `EXPIRE` lock a user out forever.
- **Pick the failure unit for batches.** An import that must be all-or-nothing flushes once at the end, so one bad row fails it. A long sync flushes per batch, so progress survives a crash. Write the choice in a `// NOTE:`.

## External systems

- **Local mirror.** Each remote object you depend on gets a table: unique `remoteId`, a human `name` key, `raw` JSON of the last payload, timestamps. Read the mirror first.
- **Upsert with `??=`.** `let local = await find(...); local ??= new Mirror(); local.name = remote.name; local.raw = remote; em.persist(local);`. Sync jobs walk the remote list and run this per item, matching on remote id or name.
- **Find-or-create.** Mirror hit: return it. Else search the remote by your metadata (`refId`, `refType`) and adopt the match. Else create it, with your ids in its metadata.
- **Correlate through metadata.** Stamp your uuid (`taskRef`) into the remote object (metadata, a label, a body marker); webhook handlers resolve back through it.
- **Webhooks.** Verify the signature, persist the event keyed by the provider's delivery id, dispatch, store the related object on the event row. Drop stale events: `if (isBefore(eventTimestamp, local.updatedAt)) return;`. Keep `replayEvent(id)` that re-dispatches a stored event. The provider is the source of truth: verify the signature, trust the payload's meaning.
- **Queue consumers.** Every handler is replayable: look up the event by its natural key (source id + event timestamp), log `already processed` and return when found. Expect events out of order and events that retract earlier ones.
- **Totals self-correct.** Derive an amount to credit as `remoteTotal - alreadyCredited`, never as "this event's delta", so a late or lost event lands in the next run.
- **Self-heal by sync.** Keep an internal `POST internal/<resource>/sync` that re-reads the source of truth and fixes the mirror. Drift from someone editing the provider's dashboard is fixed by that sync, not by a branch per way it could drift.
- **Sync on read, throttled.** A read that refreshes the mirror first takes a lock it never releases; the lock's expiry is the throttle window. No lock: serve the mirror as is.

## Caching

- **Never cache permission.** Access config (an integration's enabled flag, an API key's scopes) is read live, so revoking it bites on the next request.
- **Scope keys by tenant.** `<service>:<workspace>:<thing>:<id>`, so one tenant's entry never answers another's request.
- **Invalidate on the event.** The event that changes a value deletes its cache entry; the TTL only bounds staleness when that event is lost.

## Errors

- **Client mistakes are 4xx.** Throw the framework's HTTP exceptions; a bare `throw new Error('name_taken')` is a `500`. Map the ORM's not-found error to `404`.
- **Catch what you name.** A `catch` handles the errors it expects and rethrows the rest.
- **One bad item skips, not stops.** Inside a loop over items, a bad item logs and `continue`s; `return` silently drops the rest.
- **Bug states throw.** A state only a bug can produce throws, instead of returning `null` and spreading.
- **Tolerated surprises are loud.** A should-not-happen state you choose to survive logs `warn` and goes to error tracking.

## Numbers and time

- **Money and rates never touch floats.** Use a decimal library with precision above the widest value (common defaults truncate at 20 digits), store as `numeric(precision, scale)`, and serialize without trailing zeros.
- **`NULL` erases sums.** Wrap nullable SQL inputs in `COALESCE(x, 0)`. In code, parenthesize `??` inside arithmetic: `(a ?? 0) + (b ?? 0)`.
- **Clamp client time.** A client-sent "until" is capped at server now (`min([until, new Date()])`) instead of rejected, so clock skew never fails a request.

## Config and boundaries

- **Env validated at boot.** One class declares every required env var with validators; startup fails listing every violation at once.
- **Config per module.** Each module registers its own namespaced config beside it and injects it typed; no module reads another's config. SDK clients are module providers built by a factory from that config and injected by class token. Services read config once into `readonly` fields.
- **Knobs keep defaults.** A setting most deployments never change stays an env var with a default, left out of `.env.example` and documented separately. Env values are full words (`production`, `staging`); branch on `environment === 'staging'`, not an `isProduction` boolean, when there are more than two.
- **Constant-time secrets.** Compare API keys with a timing-safe compare; on a length mismatch, still run a same-length compare before rejecting.
- **Validation at the edge.** A global validation pipe with `whitelist` and `transform`. Field defaults (`notify: boolean = true`) live on the DTO.
- **Reject, don't repair.** Malformed input gets `400`. Trimming or rewriting it silently tells the caller a bad value was fine.
- **Bound every input.** Each array gets a max size and each string a max length, so no payload can fill memory or a column.
- **Normalize identifiers once.** Case-insensitive keys (emails, handles) are lowercased at the boundary and stored lowercased.
- **Key material stays inside.** An API returns derived values (a public key, a signature), never a stored secret or seed, not even to an internal caller.
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
- Review fixes land as `fixup!` commits and are squashed before merge, so the branch ends as the feature commit plus its migration commit.
- Convention-only cleanups ship alone as `Chore: <Area> Update (Convention)`.
- Branches: `feature/<TICKET>.<short-name>`.

## Review mode

`/rain review [base]` (base defaults to the merge-base with the default branch): read the diff and every function it touches, then walk each section above against each changed file.

- Every finding names its failure: the inputs or interleaving, then the wrong result. A finding without one is dropped.
- A claim about library or ORM behavior is checked by running it (REPL, curl, query log, `EXPLAIN`) or reading the library source, and the output goes in the finding.

Report every finding as `file:line | rule | failure | fix`, ordered concurrency, webhooks and consumers first, naming and comments last. Done when every section has a verdict, including the clean ones (`Writes under concurrency: clean`).
