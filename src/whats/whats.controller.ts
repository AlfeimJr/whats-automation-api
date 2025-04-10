// src/whatsapp/whatsapp.controller.ts
import { Controller, Post, Body, Get, UseGuards, Req } from '@nestjs/common';
import { Request } from 'express';

import { WhatsappSessionManagerService } from './whatsapp.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('whatsapp')
export class WhatsAppController {
  constructor(
    private readonly whatsappService: WhatsappSessionManagerService,
  ) {}

  // Para envio de mensagem mencionando todos os participantes
  @UseGuards(JwtAuthGuard)
  @Post('mention-all')
  async mentionAll(
    @Req() req: Request,
    @Body() body: { chatId: string; message: string },
  ) {
    const userId = req.user?.userId;
    return this.whatsappService.mentionEveryone(
      userId,
      body.chatId,
      body.message,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get('chats')
  async listChats(@Req() req: Request) {
    const userId = req.user?.userId;
    console.log('Chats para o usuário:', userId);

    const chats = await this.whatsappService.getChats(userId);
    return { chats };
  }

  // Rota para obter o QR Code - pode ser protegida ou não, mas geralmente é aberta para que o usuário acesse-a
  @UseGuards(JwtAuthGuard)
  @Get('qr')
  async getQrCode(@Req() req: Request) {
    const userId = req.user?.userId;
    console.log('QR Code para o usuário:', userId);

    return this.whatsappService.getQRCode(userId);
  }

  // Rota de envio de mensagem comum:
  @UseGuards(JwtAuthGuard)
  @Post('send')
  async sendMessage(
    @Req() req: Request,
    @Body() body: { chatId: string; message: string },
  ) {
    const userId = req.user?.userId;
    return this.whatsappService.sendMessage(userId, body.chatId, body.message);
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  async logout(@Req() req: Request) {
    const userId = req.user?.userId;
    await this.whatsappService.logout(userId);
    return { message: 'Logout realizado com sucesso' };
  }
}
