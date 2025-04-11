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
  private sessions: Map<string, WhatsAppClientData> = new Map();

  async getClientForUser(userId: string): Promise<WhatsAppClientData> {
    if (this.sessions.has(userId)) {
      return this.sessions.get(userId);
    }
    const clientData = await this.createClient(userId);
    this.sessions.set(userId, clientData);
    return clientData;
  }

  async createClient(userId: string): Promise<WhatsAppClientData> {
    const dataPath = path.join(process.cwd(), '.wwebjs_auth', userId);

    const client = new Client({
      authStrategy: new LocalAuth({
        clientId: userId,
        dataPath,
      }),
    });

    const clientData: WhatsAppClientData = {
      client,
      clientReadyPromise: null,
      qrCode: null,
    };

    clientData.clientReadyPromise = new Promise<void>((resolve, reject) => {
      // Registra o evento "qr" apenas uma vez para evitar múltiplas emissões
      client.once('qr', async (qr) => {
        this.logger.log(`QR Code recebido para o usuário ${userId}: ${qr}`);
        try {
          const dataUrl = await QRCode.toDataURL(qr);
          clientData.qrCode = dataUrl;
          // Salva o QR code em disco (opcional)
          const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
          fs.mkdirSync(dataPath, { recursive: true });
          const filePath = path.join(dataPath, 'qr.png');
          fs.writeFileSync(filePath, base64Data, 'base64');
          this.logger.log(`QR Code salvo para ${userId} em ${filePath}`);
        } catch (error) {
          this.logger.error(`Erro ao gerar QR code para ${userId}:`, error);
        }
      });

      client.once('ready', () => {
        this.logger.log(`WhatsApp Client está pronto para o usuário ${userId}`);
        clientData.qrCode = null;
        resolve();
      });

      client.once('auth_failure', (msg) => {
        this.logger.error(`Falha na autenticação para ${userId}: ${msg}`);
        reject(msg);
      });
    });

    client.initialize();
    return clientData;
  }

  async getChats(userId: string): Promise<{ id: string; name: string }[]> {
    const clientData = await this.getClientForUser(userId);
    await clientData.clientReadyPromise;
    const chats = await clientData.client.getChats();
    const groupChats = chats.filter((chat) => chat.isGroup);
    this.logger.log(
      `Chats de grupo para ${userId}: ${groupChats.length} encontrados`,
    );
    return groupChats.map((chat) => ({
      id: chat.id._serialized,
      name: chat.name || chat.id.user,
    }));
  }

  async sendMessage(userId: string, chatId: string, message: string) {
    const clientData = await this.getClientForUser(userId);
    await clientData.clientReadyPromise;
    const chat = await clientData.client.getChatById(chatId);
    if (!chat) throw new Error('Chat não encontrado');
    return chat.sendMessage(message);
  }

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

  async getQRCode(userId: string): Promise<{ qr?: string; ready?: boolean }> {
    const clientData = await this.getClientForUser(userId);
    if (clientData.qrCode) {
      return { qr: clientData.qrCode };
    }
    return { ready: true };
  }

  async logout(userId: string): Promise<void> {
    if (!this.sessions.has(userId)) {
      this.logger.warn(
        `Tentativa de logout para usuário inexistente: ${userId}`,
      );
      return;
    }
    const clientData = this.sessions.get(userId);
    const dataPath = path.join(process.cwd(), '.wwebjs_auth', userId);
    try {
      if (clientData.client && clientData.client.info) {
        await Promise.race([
          clientData.client.logout(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Timeout no logout')), 10000),
          ),
        ]);
      }
    } catch (error) {
      this.logger.warn(`Erro no processo de logout para ${userId}:`, error);
    } finally {
      try {
        if (clientData.client) {
          await clientData.client.destroy();
        }
        this.logger.log(`Cliente destruído para o usuário ${userId}`);
      } catch (destroyError) {
        this.logger.warn(
          `Erro ao destruir cliente para ${userId}:`,
          destroyError,
        );
      }
      this.sessions.delete(userId);
      try {
        if (fs.existsSync(dataPath)) {
          fs.rmSync(dataPath, { recursive: true, force: true });
          this.logger.log(
            `Diretório de sessão removido para o usuário ${userId}`,
          );
        }
      } catch (fsError) {
        this.logger.warn(
          `Erro ao remover diretório de sessão para ${userId}:`,
          fsError,
        );
      }
    }
  }
}
