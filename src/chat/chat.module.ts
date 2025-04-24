// src/chat/chat.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ChatService } from './chat.service';
import { Chat } from './entities/chat.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Chat])],
  providers: [ChatService],
  exports: [ChatService],
})
export class ChatModule {}
