import { Entity, PrimaryKey, Property } from '@mikro-orm/core';

@Entity()
export class Member {
  @PrimaryKey()
  id!: number;

  // id of this person in the HR service
  @Property()
  externalId!: string;

  @Property()
  githubLogin!: string;

  @Property()
  completedTasks: number = 0;
}
