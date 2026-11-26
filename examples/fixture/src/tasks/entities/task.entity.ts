import { Entity, Enum, ManyToOne, PrimaryKey, Property } from '@mikro-orm/core';
import { TaskStatus } from '../enums/task-status.enum';
import { Member } from './member.entity';

@Entity()
export class Task {
  @PrimaryKey()
  id!: number;

  @Property()
  title!: string;

  @ManyToOne(() => Member, { nullable: true })
  assignee?: Member;

  @Enum(() => TaskStatus)
  status: TaskStatus = TaskStatus.OPEN;

  // "owner/repo#123", set when someone links a pull request to the task
  @Property({ nullable: true })
  githubPullRequest?: string;

  @Property()
  createdAt: Date = new Date();
}
