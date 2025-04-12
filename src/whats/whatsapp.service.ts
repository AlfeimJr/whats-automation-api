// whatsapp-session-manager.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { Client, LocalAuth } from 'whatsapp-web.js';
import * as fs from 'fs';
import * as path from 'path';
import * as QRCode from 'qrcode'; // Usado para gerar o QR code em formato ASCII

interface WhatsAppClientData {
  client: Client;
  clientReadyPromise: Promise<void>;
  qrCode: string | null; // Armazena o QR code em formato ASCII
}

@Injectable()
export class WhatsappSessionManagerService {
  private readonly logger = new Logger(WhatsappSessionManagerService.name);
  private sessions: Map<string, WhatsAppClientData> = new Map();
  private chatCache: Map<string, { data: any[]; timestamp: number }> =
    new Map();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutos

  async getClientForUser(userId: string): Promise<WhatsAppClientData> {
    this.logger.log(`getClientForUser chamado para ${userId}`);
    if (this.sessions.has(userId)) {
      return this.sessions.get(userId)!;
    }
    const clientData = await this.createClient(userId);
    this.sessions.set(userId, clientData);
    return clientData;
  }

  async createClient(userId: string): Promise<WhatsAppClientData> {
    const dataPath = path.join(process.cwd(), '.wwebjs_auth', userId);

    const client = new Client({
      authStrategy: new LocalAuth({ clientId: userId }),
      puppeteer: {
        headless: true, // Modo headless para produção
        args: [
          '--no-sandbox',
          '--disable-gpu',
          '--disable-web-security',
          '--disable-features=IsolateOrigins,site-per-process',
        ],
        dumpio: true,
      },
    });

    let firstQrShown = false;
    let qrExpirationTimer: NodeJS.Timeout;
    const clientData: WhatsAppClientData = {
      client,
      qrCode: null,
      clientReadyPromise: new Promise<void>((resolve, reject) => {
        client.on('qr', async (qr: string) => {
          // Ignora a renovação do QR se já tiver sido exibido
          if (firstQrShown) {
            this.logger.log(`Renovação do QR ignorada para ${userId}`);
            return;
          }
          firstQrShown = true;
          this.logger.log(`Novo QR code para ${userId}`);

          try {
            // Gera o QR code ASCII usando QRCode.toString com type 'utf8'
            const asciiQr = await QRCode.toString(qr, {
              type: 'utf8',
              small: true,
            });
            clientData.qrCode = asciiQr;

            // Salva o QR code ASCII em disco (opcional)
            fs.mkdirSync(dataPath, { recursive: true });
            fs.writeFileSync(path.join(dataPath, 'qr.txt'), asciiQr, 'utf8');
            fs.writeFileSync(path.join(dataPath, 'qr_data.txt'), qr, 'utf8');

            this.logger.log(`QR code ASCII gerado para ${userId}`);

            // Define temporizador para expirar o QR após 2 minutos
            qrExpirationTimer = setTimeout(() => {
              if (clientData.qrCode) {
                this.logger.log(`QR code expirado para ${userId}`);
                clientData.qrCode = null;
              }
            }, 2 * 60 * 1000);
          } catch (err) {
            this.logger.error(`Erro ao gerar QR para ${userId}`, err);
            try {
              fs.mkdirSync(dataPath, { recursive: true });
              fs.writeFileSync(path.join(dataPath, 'qr_data.txt'), qr, 'utf8');
            } catch (fsErr) {
              this.logger.error(`Erro ao salvar QR data para ${userId}`, fsErr);
            }
            clientData.qrCode = `Escaneie este código: ${qr.substring(
              0,
              20,
            )}...`;
          }
        });

        client.on('ready', () => {
          if (qrExpirationTimer) clearTimeout(qrExpirationTimer);
          this.logger.log(`Client [${userId}] pronto (autenticado)`);
          // *** Comentei a linha abaixo para preservar o QR code para o endpoint ***
          // clientData.qrCode = null;
          resolve();
        });

        client.on('auth_failure', (msg) => {
          if (qrExpirationTimer) clearTimeout(qrExpirationTimer);
          this.logger.error(`Auth fail para ${userId}: ${msg}`);
          reject(msg);
        });

        client.on('disconnected', (reason) => {
          this.logger.warn(`Cliente desconectado para ${userId}: ${reason}`);
          if (qrExpirationTimer) clearTimeout(qrExpirationTimer);
        });
      }),
    };

    try {
      client.initialize();
    } catch (error) {
      this.logger.error(`Erro ao inicializar cliente para ${userId}`, error);
      throw error;
    }

    return clientData;
  }

  async getChats(userId: string): Promise<{ id: string; name: string }[]> {
    this.logger.log(`getChats chamado para ${userId}`);
    const cache = this.chatCache.get(userId);
    const now = Date.now();
    if (cache && now - cache.timestamp < this.CACHE_TTL) {
      this.logger.log(`Usando cache de chats para ${userId}`);
      return cache.data;
    }
    try {
      const clientData = await this.getClientForUser(userId);
      await clientData.clientReadyPromise;
      const chats = await clientData.client.getChats();
      const groupChats = chats.filter((chat) => chat.isGroup);
      this.logger.log(`Encontrados ${groupChats.length} grupos para ${userId}`);
      const result = groupChats.map((chat) => ({
        id: chat.id._serialized,
        name: chat.name || chat.id.user,
      }));
      this.chatCache.set(userId, { data: result, timestamp: now });
      return result;
    } catch (error) {
      this.logger.error(`Erro ao obter chats para ${userId}`, error);
      throw error;
    }
  }

  async sendMessage(userId: string, chatId: string, message: string) {
    try {
      const clientData = await this.getClientForUser(userId);
      await clientData.clientReadyPromise;
      return clientData.client.sendMessage(chatId, message);
    } catch (error) {
      this.logger.error(
        `Erro ao enviar mensagem para ${chatId} (usuário ${userId})`,
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
      if (!chat)
        throw new Error(`Chat ${chatId} não encontrado para ${userId}`);
      if (!chat.isGroup)
        throw new Error(`Chat ${chatId} não é um grupo para ${userId}`);
      const groupChat = chat as any;
      const mentions = groupChat.participants.map(
        (participant: any) => participant.id._serialized,
      );
      return clientData.client.sendMessage(chatId, message, { mentions });
    } catch (error) {
      this.logger.error(
        `Erro ao mencionar todos em ${chatId} (usuário ${userId})`,
        error,
      );
      throw error;
    }
  }

  // Método modificado que aguarda até que o QR code seja gerado antes de retornar
  async getQRCode(userId: string): Promise<string> {
    try {
      const clientData = await this.getClientForUser(userId);
      let attempts = 0;
      // Aguarda até que o QR code seja gerado ou até que o cliente seja autenticado
      while (!clientData.client.info && !clientData.qrCode && attempts < 10) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        attempts++;
      }
      // Se o cliente ainda não estiver autenticado e o QR code foi gerado, retorna-o
      if (!clientData.client.info && clientData.qrCode) {
        return clientData.qrCode;
      }
      return ''; // Retorna vazio se o cliente estiver autenticado ou se não houver QR code
    } catch (error) {
      this.logger.error(`Erro ao obter QR code para ${userId}`, error);
      throw error;
    }
  }

  async logout(userId: string): Promise<void> {
    if (!this.sessions.has(userId)) {
      this.logger.warn(`Tentativa de logout de userId inexistente: ${userId}`);
      return;
    }
    const clientData = this.sessions.get(userId)!;
    try {
      if (clientData.client && clientData.client.info) {
        await Promise.race([
          clientData.client.logout(),
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error('Timeout durante o logout')),
              10000,
            ),
          ),
        ]);
      }
    } catch (error) {
      this.logger.warn(`Erro no logout para ${userId}:`, error);
    } finally {
      try {
        if (clientData.client) {
          await clientData.client.destroy();
        }
        this.logger.log(`Cliente destruído para ${userId}`);
      } catch (destroyError) {
        this.logger.warn(
          `Erro ao destruir cliente para ${userId}:`,
          destroyError,
        );
      }
      this.sessions.delete(userId);
    }
  }

  async getConnectionStatus(userId: string): Promise<string> {
    try {
      const clientData = await this.getClientForUser(userId);
      if (!clientData.client || !clientData.client.info) {
        return 'disconnected';
      }
      return 'connected';
    } catch (error) {
      this.logger.error(
        `Erro ao verificar status da conexão para ${userId}`,
        error,
      );
      return 'error';
    }
  }
}
