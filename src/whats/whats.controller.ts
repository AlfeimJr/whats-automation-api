import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  Request,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SubscriptionGuard } from '../subscription/subscription.guard';
import { WhatsappSessionManagerService } from './whatsapp.service';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';

@ApiTags('WhatsApp')
@Controller('whatsapp')
export class WhatsController {
  constructor(
    private readonly whatsappService: WhatsappSessionManagerService,
  ) {}

  // Rota protegida por ambos os guards
  @UseGuards(JwtAuthGuard, SubscriptionGuard)
  @Get('qrcode')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Obter QR code para autenticação do WhatsApp' })
  async getQRCode(@Request() req) {
    const userId = req.user.userId;
    return this.whatsappService.getQRCode(userId);
  }

  @UseGuards(JwtAuthGuard, SubscriptionGuard)
  @Get('chats')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Listar chats disponíveis' })
  async getChats(@Request() req) {
    const userId = req.user.userId;
    return this.whatsappService.getChats(userId);
  }

  @UseGuards(JwtAuthGuard, SubscriptionGuard)
  @Post('send/:chatId')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Enviar mensagem para um chat' })
  async sendMessage(
    @Request() req,
    @Param('chatId') chatId: string,
    @Body('message') message: string,
  ) {
    const userId = req.user.userId;
    return this.whatsappService.sendMessage(userId, chatId, message);
  }

  @UseGuards(JwtAuthGuard, SubscriptionGuard)
  @Post('mention-all/:chatId')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Mencionar todos os participantes de um grupo' })
  async mentionEveryone(
    @Request() req,
    @Param('chatId') chatId: string,
    @Body('message') message: string,
  ) {
    const userId = req.user.userId;
    return this.whatsappService.mentionEveryone(userId, chatId, message);
  }

  @UseGuards(JwtAuthGuard, SubscriptionGuard)
  @Get('status')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Verificar status da conexão do WhatsApp' })
  async getConnectionStatus(@Request() req) {
    const userId = req.user.userId;
    return this.whatsappService.getConnectionStatus(userId);
  }

  @UseGuards(JwtAuthGuard, SubscriptionGuard)
  @Post('logout')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Desconectar sessão do WhatsApp' })
  async logout(@Request() req) {
    const userId = req.user.userId;
    return this.whatsappService.logout(userId);
  }
}
