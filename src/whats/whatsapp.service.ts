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
  private chatCache: Map<string, { data: any[]; timestamp: number }> =
    new Map();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutos em milissegundos
  private readonly AUTH_TIMEOUT = 60000; // Timeout de 60 segundos para autenticação

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

    // Cria uma promise com timeout para evitar ficar esperando indefinidamente
    clientData.clientReadyPromise = new Promise<void>((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        const errorMsg = `Timeout de autenticação excedido para o usuário ${userId}`;
        this.logger.error(errorMsg);
        reject(new Error(errorMsg));
      }, this.AUTH_TIMEOUT);

      client.on('qr', async (qr) => {
        const now = new Date().toISOString();
        this.logger.log(`[${now}] QR Code recebido para o usuário ${userId}`);
        try {
          const dataUrl = await QRCode.toDataURL(qr);
          clientData.qrCode = dataUrl;
          // Salva o QR code em disco (opcional)
          fs.mkdirSync(dataPath, { recursive: true });
          const filePath = path.join(dataPath, 'qr.png');
          const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
          fs.writeFileSync(filePath, base64Data, 'base64');
          this.logger.log(
            `[${now}] QR Code salvo para ${userId} em ${filePath}`,
          );
        } catch (error) {
          this.logger.error(
            `[${now}] Erro ao gerar QR code para ${userId}:`,
            error,
          );
        }
      });

      client.on('authenticated', (session) => {
        this.logger.log(`Usuário ${userId} autenticado com sucesso.`);
      });

      client.on('ready', () => {
        const now = new Date().toISOString();
        this.logger.log(
          `[${now}] WhatsApp Client está pronto para o usuário ${userId}`,
        );
        clientData.qrCode = null;
        clearTimeout(timeoutHandle);
        resolve();
      });

      client.on('auth_failure', (msg) => {
        const now = new Date().toISOString();
        this.logger.error(
          `[${now}] Falha na autenticação para ${userId}: ${msg}`,
        );
        clearTimeout(timeoutHandle);
        reject(new Error(`Falha na autenticação: ${msg}`));
      });

      client.on('disconnected', (reason) => {
        const now = new Date().toISOString();
        this.logger.warn(
          `[${now}] Cliente desconectado para ${userId}: ${reason}`,
        );
      });
    });

    try {
      client.initialize();
    } catch (error) {
      this.logger.error('Erro ao inicializar o cliente:', error);
      throw error;
    }
    return clientData;
  }

  async getChats(userId: string): Promise<{ id: string; name: string }[]> {
    // Verificar cache
    const cache = this.chatCache.get(userId);
    const now = Date.now();
    if (cache && now - cache.timestamp < this.CACHE_TTL) {
      this.logger.log(`Usando cache de chats para ${userId}`);
      return cache.data;
    }

    try {
      // Buscar dados normalmente
      const clientData = await this.getClientForUser(userId);
      await clientData.clientReadyPromise;
      const chats = await clientData.client.getChats();
      // Filtrar apenas grupos
      const groupChats = chats.filter((chat) => chat.isGroup);

      // Processar e armazenar no cache
      const result = groupChats.map((chat) => ({
        id: chat.id._serialized,
        name: chat.name || chat.id.user,
      }));

      this.chatCache.set(userId, {
        data: result,
        timestamp: now,
      });

      this.logger.log(
        `Chats de grupo para ${userId}: ${groupChats.length} encontrados`,
      );
      return result;
    } catch (error) {
      this.logger.error(`Erro ao obter chats para ${userId}:`, error);
      throw error;
    }
  }

  async sendMessage(userId: string, chatId: string, message: string) {
    try {
      const clientData = await this.getClientForUser(userId);
      await clientData.clientReadyPromise;
      const chat = await clientData.client.getChatById(chatId);
      if (!chat) throw new Error('Chat não encontrado');
      return chat.sendMessage(message);
    } catch (error) {
      this.logger.error(
        `Erro ao enviar mensagem para ${userId} no chat ${chatId}:`,
        error,
      );
      throw error;
    }
  }

  async mentionEveryone(userId: string, chatId: string, message: string) {
    try {
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
    } catch (error) {
      this.logger.error(
        `Erro ao mencionar todos no chat ${chatId} para ${userId}:`,
        error,
      );
      throw error;
    }
  }

  async getQRCode(userId: string): Promise<{ qr?: string; ready?: boolean }> {
    try {
      const clientData = await this.getClientForUser(userId);
      if (clientData.qrCode) {
        return { qr: clientData.qrCode };
      }
      return { ready: true };
    } catch (error) {
      this.logger.error(`Erro ao obter QR Code para ${userId}:`, error);
      throw error;
    }
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
