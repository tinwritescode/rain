# rAIn for TypeScript + NestJS

Concrete forms of the rules in [SKILL.md](SKILL.md) for a NestJS service on MikroORM and class-validator. Adapt names to the project's ORM and validator when they differ. Examples use a task tracker that integrates with GitHub.

## Tooling

- Prettier: `{ "printWidth": 120, "singleQuote": true, "trailingComma": "all" }`.
- Lint `no-floating-promises` as an error; top-level entrypoints end in `void bootstrap();`.
- `strict: true` with `strictPropertyInitialization: false` (entities and DTOs are filled by the framework). `any` is acceptable only for raw provider payloads stored as JSON.

## Imports

Blocks separated by a blank line, in this order: framework and libraries; services from other modules; entities; enums; default-imported config last.

```ts
import { EntityManager, LockMode } from '@mikro-orm/postgresql';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { NotificationService } from '../../notification/services/notification.service';

import { Member } from '../entities/member.entity';
import { Task } from '../entities/task.entity';

import { TaskStatus } from '../enums/task-status.enum';
```

## Entrypoints

One codebase, one entry file per process, one script each:

| File | Script | Runs |
|---|---|---|
| `src/main.ts` | `start` | HTTP API, global `ValidationPipe`, optional migrate-on-boot behind an env flag |
| `src/worker.ts` | `start:worker` | Cron jobs only, plus `/healthz` |
| `src/repl.ts` | `repl` | Nest REPL with history |
| `src/database/migration-runner.ts` | `db:migration:{create,up,down,check}` | ORM migrator |

Worker crons hold a distributed lock keyed `<service>:<env>:locks:<job>` so replicas never overlap:

```ts
@Cron('0 3 * * *')
@WithoutOverlapping({ key: 'nightly-repository-sync', ttl: '5m' })
async nightlyRepositorySync() { ... }
```

## Config

```ts
// github/github.config.ts
export const GithubConfig = registerAs('github', () => ({
  appToken: process.env.GITHUB_APP_TOKEN!,
  webhookSecret: process.env.GITHUB_WEBHOOK_SECRET!,
}));
export default GithubConfig;

// github/github.module.ts
@Module({
  imports: [ConfigModule.forFeature(GithubConfig)],
  providers: [
    {
      provide: Octokit,
      inject: [GithubConfig.KEY],
      useFactory: (config: ConfigType<typeof GithubConfig>) => new Octokit({ auth: config.appToken }),
    },

    GithubRepositoryService,
  ],
  exports: [GithubRepositoryService, Octokit],
})
export class GithubModule {}
```

Env validation: a class with one validator per variable, `plainToInstance` then `validateSync` with every `skip*` option `false`, throwing one error that lists every failed constraint. Pass it as `ConfigModule.forRoot({ validate })` in the API and worker root modules.

## Entities

`defineEntity` with a class extension; repository as an empty subclass, fetched with `em.getRepository(Entity)`.

```ts
export const TaskSchema = defineEntity({
  name: 'Task',
  repository: () => TaskRepository,
  properties: {
    id: p.bigint<'string'>('string').primary(),
    uuid: p.uuid().defaultRaw('gen_random_uuid()').unique(),
    assignee: p.manyToOne(Member).nullable().index(),
    title: p.text(),
    status: p.enum(TaskStatus).index(),
    createdAt: p.datetime().defaultRaw('NOW()'),
    updatedAt: p
      .datetime()
      .defaultRaw('NOW()')
      .onUpdate(() => new Date()),
  },
});

export class Task extends TaskSchema.class {}

TaskSchema.setClass(Task);
```

Mirror tables add `remoteId: p.text().unique().comment('GitHub Repository ID')`, `name: p.text().nullable()`, `raw: p.json<GithubRepository>().nullable()`.

## DTOs

Decorator stack per field: `@IsOptional()` first, then presence (`@IsNotEmpty()`), then type, then format.

```ts
const MAX_REASON_LENGTH = 500;

export class InternalTaskCloseRequestParamsDto {
  @IsNotEmpty()
  @IsString()
  @IsUUID()
  task: string;
}

export class InternalTaskCloseRequestBodyDto {
  @IsNotEmpty()
  @IsString()
  memberId: string;

  @IsOptional()
  @IsBoolean()
  notify: boolean = true;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_REASON_LENGTH)
  reason?: string;
}
```

## Controllers

```ts
@Controller('internal/task')
@UseGuards(InternalApiKeyGuard)
export class InternalTaskController {
  constructor(private readonly taskService: TaskService) {}

  @Post(':task/close')
  @HttpCode(HttpStatus.OK)
  async close(
    @Param() params: InternalTaskCloseRequestParamsDto,
    @Body() body: InternalTaskCloseRequestBodyDto,
  ): Promise<InternalTaskCloseResponseBodyDto> {
    return await this.taskService.close(
      params.task,
      { refId: body.memberId },
      { notify: body.notify, reason: body.reason },
    );
  }
}
```

A `POST` that does not create gets an explicit `@HttpCode(HttpStatus.OK)`. Every handler declares its return type.

## Services: lock the owner, then recheck

```ts
async complete(taskRef: string, opts: { mergedAt: Date }) {
  await this.entityManager.transactional(async (em) => {
    let task = await em.findOne(Task, { uuid: taskRef, status: TaskStatus.OPEN }, { populate: ['assignee'] });
    if (task === null || task.assignee === null) return;

    await this.lockMember(task.assignee, em);

    task = await em.refresh(task);
    if (task === null || task.status !== TaskStatus.OPEN) return;
    if (isBefore(opts.mergedAt, task.updatedAt)) return;

    task.status = TaskStatus.DONE;
    task.assignee!.completedTasks += 1;

    await em.flush();
  });
}

private async lockMember(memberOpts: { refId: string } | Member, em: EntityManager): Promise<Member> {
  if (memberOpts instanceof Member) {
    await em.lock(memberOpts, LockMode.PESSIMISTIC_WRITE);
    return memberOpts;
  }

  const member = await em.findOne(Member, { refId: memberOpts.refId }, { lockMode: LockMode.PESSIMISTIC_WRITE });
  if (member === null) throw new NotFoundException('Member Not Found');
  return member;
}
```

## Webhooks

One controller, one route per provider: `@Post(':provider')` under `@Controller('webhook')`, `@HttpCode(200)`, raw body enabled at `NestFactory.create(AppModule, { rawBody: true })`. Signature failure becomes `UnauthorizedException`; everything else rethrows so the provider retries.

```ts
async processEvent(rawBody: Buffer, headers: IncomingHttpHeaders) {
  const deliveryId = this.verifyGithubSignature(rawBody, headers);

  let webhook = await this.entityManager.findOne(WebhookDelivery, { provider: 'github', remoteId: deliveryId });
  if (webhook === null) {
    webhook = new WebhookDelivery();
    webhook.provider = 'github';
    webhook.remoteId = deliveryId;
    webhook.payload = JSON.parse(rawBody.toString('utf8'));
    await this.entityManager.persist(webhook).flush();
  }

  const relatedObject = await this.dispatch(webhook);
  if (relatedObject !== null) {
    webhook.relatedObject = relatedObject;
    await this.entityManager.flush();
  }
}
```

## API key guard

```ts
canActivate(context: ExecutionContext): boolean {
  const header = context.switchToHttp().getRequest<Request>().headers['x-internal-api-key'];
  const given = Buffer.from(typeof header === 'string' ? header : '');

  // NOTE: Compare equal-length buffers either way so response time does not reveal the key length.
  const matches = timingSafeEqual(given.length === this.key.length ? given : this.key, this.key);
  if (given.length !== this.key.length || !matches) throw new ForbiddenException();

  return true;
}
```
