// src/chat/chat.service.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Chat } from './entities/chat.entity';

@Injectable()
export class ChatService {
  constructor(
    @InjectRepository(Chat)
    private chatRepository: Repository<Chat>,
  ) {}

  async saveChats(chats: { id: string; name: string }[]): Promise<Chat[]> {
    const chatEntities = chats.map((chatData) => {
      const chat = new Chat();
      chat.chatId = chatData.id;
      chat.name = chatData.name;
      return chat;
    });

    return this.chatRepository.save(chatEntities);
  }

  // Você também pode adicionar métodos para buscar, atualizar ou remover chats
}
