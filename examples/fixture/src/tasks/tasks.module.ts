import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';
import { Member } from './entities/member.entity';
import { Task } from './entities/task.entity';

@Module({
  imports: [MikroOrmModule.forFeature([Task, Member])],
})
export class TasksModule {}
