// src/whatsapp/whatsapp-session-manager.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { Client, LocalAuth, Chat, GroupChat } from 'whatsapp-web.js';
import * as QRCode from 'qrcode';
import * as fs from 'fs';
import * as path from 'path';

interface WhatsAppClientData {
  client: Client;
  clientReadyPromise: Promise<void>;
  qrCode: string | null;
}

@Injectable()
export class WhatsappSessionManagerService {
  private readonly logger = new Logger(WhatsappSessionManagerService.name);
  // Mapa onde a chave é o userId e o valor é a instância do WhatsApp para aquele usuário
  private sessions: Map<string, WhatsAppClientData> = new Map();

  /**
   * Retorna (ou cria, se não existir) uma instância do WhatsApp para o usuário.
   */
  async getClientForUser(userId: string): Promise<WhatsAppClientData> {
    if (this.sessions.has(userId)) {
      return this.sessions.get(userId);
    }
    const clientData = await this.createClient(userId);
    this.sessions.set(userId, clientData);
    return clientData;
  }

  /**
   * Cria uma nova instância do WhatsApp client para um usuário específico.
   * Utilizamos o userId para definir o clientId e o dataPath, garantindo sessão exclusiva.
   */
  async createClient(userId: string): Promise<WhatsAppClientData> {
    const dataPath = path.join(process.cwd(), '.wwebjs_auth', userId);

    const client = new Client({
      authStrategy: new LocalAuth({
        clientId: userId,
        dataPath: dataPath,
      }),
    });

    const clientData: WhatsAppClientData = {
      client,
      clientReadyPromise: null,
      qrCode: null,
    };

    clientData.clientReadyPromise = new Promise<void>((resolve, reject) => {
      client.on('qr', async (qr) => {
        this.logger.log(`QR Code recebido para o usuário ${userId}: ${qr}`);
        try {
          const dataUrl = await QRCode.toDataURL(qr);
          clientData.qrCode = dataUrl;
          // (Opcional) Salvar a imagem em disco:
          const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
          fs.mkdirSync(dataPath, { recursive: true });
          const filePath = path.join(dataPath, 'qr.png');
          fs.writeFileSync(filePath, base64Data, 'base64');
          this.logger.log(`QR Code salvo para ${userId} em ${filePath}`);
        } catch (error) {
          this.logger.error(`Erro ao gerar QR code para ${userId}:`, error);
        }
      });

      client.on('ready', () => {
        this.logger.log(`WhatsApp Client está pronto para o usuário ${userId}`);
        clientData.qrCode = null; // Limpa o QR para indicar que já autenticou
        resolve();
      });

      client.on('auth_failure', (msg) => {
        this.logger.error(`Falha na autenticação para ${userId}: ${msg}`);
        reject(msg);
      });
    });

    client.initialize();

    return clientData;
  }

  // Exemplo: método para obter os chats de grupo para um usuário
  async getChats(userId: string): Promise<{ id: string; name: string }[]> {
    const clientData = await this.getClientForUser(userId);
    await clientData.clientReadyPromise;
    const chats = await clientData.client.getChats();
    const groupChats = chats.filter((chat) => chat.isGroup);
    return groupChats.map((chat) => ({
      id: chat.id._serialized,
      name: chat.name || chat.id.user,
    }));
  }

  // Envia uma mensagem comum para o chat de um usuário
  async sendMessage(userId: string, chatId: string, message: string) {
    const clientData = await this.getClientForUser(userId);
    await clientData.clientReadyPromise;
    const chat = await clientData.client.getChatById(chatId);
    if (!chat) throw new Error('Chat não encontrado');
    return chat.sendMessage(message);
  }

  // Envia mensagem mencionando todos os participantes do grupo
  async mentionEveryone(userId: string, chatId: string, message: string) {
    const clientData = await this.getClientForUser(userId);
    await clientData.clientReadyPromise;
    const chat = await clientData.client.getChatById(chatId);
    if (!chat) throw new Error('Chat não encontrado');
    if (!chat.isGroup) throw new Error('O chat não é um grupo');
    const groupChat = chat as GroupChat;
    if (!groupChat.participants)
      throw new Error('Participantes não disponíveis');
    const mentionJids = groupChat.participants.map((p) => p.id._serialized);
    return chat.sendMessage(message, { mentions: mentionJids });
  }

  // Retorna o QR code para um usuário, se houver
  async getQRCode(userId: string): Promise<{ qr?: string; ready?: boolean }> {
    const clientData = await this.getClientForUser(userId);
    if (clientData.qrCode) {
      return { qr: clientData.qrCode };
    }
    return { ready: true };
  }
}
