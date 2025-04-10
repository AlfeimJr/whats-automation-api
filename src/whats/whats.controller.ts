// src/whatsapp/whatsapp.controller.ts
import { Controller, Post, Body, Get, UseGuards, Req } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { WhatsappSessionManagerService } from './whatsapp.service';

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
    const userId = req.user?.userId.toString();
    return this.whatsappService.mentionEveryone(
      userId,
      body.chatId,
      body.message,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get('chats')
  async listChats(@Req() req: Request) {
    const userId = req.user?.userId.toString();
    const chats = await this.whatsappService.getChats(userId);
    return { chats };
  }

  // Rota para obter o QR Code - pode ser protegida ou não, mas geralmente é aberta para que o usuário acesse-a
  @Get('qr')
  async getQrCode(@Req() req: Request) {
    const userId = req.user?.userId.toString() || 'default'; // se o usuário não estiver autenticado, pode usar um id default ou tratar diferentemente
    return this.whatsappService.getQRCode(userId);
  }

  // Rota de envio de mensagem comum:
  @UseGuards(JwtAuthGuard)
  @Post('send')
  async sendMessage(
    @Req() req: Request,
    @Body() body: { chatId: string; message: string },
  ) {
    const userId = req.user?.userId.toString();
    return this.whatsappService.sendMessage(userId, body.chatId, body.message);
  }
}
