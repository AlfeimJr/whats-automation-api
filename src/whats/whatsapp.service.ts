import { Injectable, Logger } from '@nestjs/common';
import { Client, LocalAuth, Chat, GroupChat } from 'whatsapp-web.js';
import * as QRCode from 'qrcode';
import * as fs from 'fs';
import * as path from 'path';

interface WhatsAppClientData {
  client: Client;
  clientReadyPromise: Promise<void>;
  qrCode: string | null;
  isReady: boolean;
}

@Injectable()
export class WhatsappSessionManagerService {
  private readonly logger = new Logger(WhatsappSessionManagerService.name);
  private sessions: Map<string, WhatsAppClientData> = new Map();

  async getClientForUser(userId: string): Promise<WhatsAppClientData> {
    if (this.sessions.has(userId)) {
      const existingData = this.sessions.get(userId);
      // Verificar se o cliente está em estado válido
      try {
        await existingData.client.getState();
        return existingData;
      } catch (error) {
        this.logger.warn(
          `Cliente em estado inválido para ${userId}, recriando...`,
        );
        await this.logout(userId);
      }
    }

    const clientData = await this.createClient(userId);
    this.sessions.set(userId, clientData);
    return clientData;
  }

  async createClient(userId: string): Promise<WhatsAppClientData> {
    const dataPath = path.join(process.cwd(), '.wwebjs_auth', userId);

    // Garantir que o diretório existe com as permissões corretas
    fs.mkdirSync(dataPath, { recursive: true });

    const client = new Client({
      authStrategy: new LocalAuth({
        clientId: userId,
        dataPath,
      }),
      puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      },
    });

    const clientData: WhatsAppClientData = {
      client,
      clientReadyPromise: null,
      qrCode: null,
      isReady: false,
    };

    clientData.clientReadyPromise = new Promise<void>((resolve, reject) => {
      // Usar 'on' em vez de 'once' para capturar todos os eventos QR
      client.on('qr', async (qr) => {
        this.logger.log(`QR Code recebido para o usuário ${userId}`);
        try {
          const dataUrl = await QRCode.toDataURL(qr);
          clientData.qrCode = dataUrl;
          clientData.isReady = false;

          // Salva o QR code em disco
          const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
          const filePath = path.join(dataPath, 'qr.png');
          fs.writeFileSync(filePath, base64Data, 'base64');
          this.logger.log(`QR Code salvo para ${userId} em ${filePath}`);
        } catch (error) {
          this.logger.error(`Erro ao gerar QR code para ${userId}:`, error);
        }
      });

      client.on('ready', () => {
        this.logger.log(`WhatsApp Client está pronto para o usuário ${userId}`);
        clientData.qrCode = null;
        clientData.isReady = true;
        resolve();
      });

      client.on('authenticated', () => {
        this.logger.log(`Cliente autenticado para ${userId}`);
        clientData.qrCode = null;
      });

      client.on('auth_failure', (msg) => {
        this.logger.error(`Falha na autenticação para ${userId}: ${msg}`);
        clientData.isReady = false;
        reject(msg);
      });

      client.on('disconnected', async (reason) => {
        this.logger.warn(`Cliente desconectado para ${userId}: ${reason}`);
        clientData.qrCode = null;
        clientData.isReady = false;

        // Tentar reconectar automaticamente após 5 segundos
        setTimeout(() => {
          this.logger.log(`Tentando reconectar cliente para ${userId}`);
          client.initialize().catch((err) => {
            this.logger.error(`Erro ao reconectar para ${userId}:`, err);
          });
        }, 5000);
      });
    });

    client.initialize().catch((err) => {
      this.logger.error(`Erro ao inicializar cliente para ${userId}:`, err);
    });

    return clientData;
  }

  async getChats(userId: string): Promise<{ id: string; name: string }[]> {
    const clientData = await this.getClientForUser(userId);

    try {
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
    } catch (error) {
      this.logger.error(`Erro ao obter chats para ${userId}:`, error);
      throw new Error(`Não foi possível obter os chats: ${error.message}`);
    }
  }

  async sendMessage(userId: string, chatId: string, message: string) {
    const clientData = await this.getClientForUser(userId);

    try {
      await clientData.clientReadyPromise;
      const chat = await clientData.client.getChatById(chatId);
      if (!chat) throw new Error('Chat não encontrado');
      return chat.sendMessage(message);
    } catch (error) {
      this.logger.error(
        `Erro ao enviar mensagem para ${userId} em ${chatId}:`,
        error,
      );
      throw new Error(`Não foi possível enviar a mensagem: ${error.message}`);
    }
  }

  async mentionEveryone(userId: string, chatId: string, message: string) {
    const clientData = await this.getClientForUser(userId);

    try {
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
        `Erro ao mencionar todos em ${chatId} para ${userId}:`,
        error,
      );
      throw new Error(`Não foi possível mencionar todos: ${error.message}`);
    }
  }

  async getQRCode(userId: string): Promise<{ qr?: string; ready?: boolean }> {
    const clientData = await this.getClientForUser(userId);

    if (clientData.isReady) {
      return { ready: true };
    }

    if (clientData.qrCode) {
      return { qr: clientData.qrCode };
    }

    // Se não tiver QR code nem estiver pronto, provavelmente está inicializando
    return { ready: false };
  }

  async checkClientState(userId: string): Promise<string> {
    if (!this.sessions.has(userId)) {
      return 'NOT_INITIALIZED';
    }

    const clientData = this.sessions.get(userId);

    try {
      const state = await clientData.client.getState();
      return state || 'UNKNOWN';
    } catch (error) {
      this.logger.warn(
        `Erro ao verificar estado do cliente para ${userId}:`,
        error,
      );
      return 'ERROR';
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
      if (clientData.client) {
        try {
          const state = await clientData.client.getState();
          if (state) {
            await Promise.race([
              clientData.client.logout(),
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Timeout no logout')), 10000),
              ),
            ]);
            this.logger.log(`Logout realizado com sucesso para ${userId}`);
          }
        } catch (logoutError) {
          this.logger.warn(
            `Erro no processo de logout para ${userId}:`,
            logoutError,
          );
        }

        try {
          await clientData.client.destroy();
          this.logger.log(`Cliente destruído para o usuário ${userId}`);
        } catch (destroyError) {
          this.logger.warn(
            `Erro ao destruir cliente para ${userId}:`,
            destroyError,
          );
        }
      }
    } finally {
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

  // Método para verificar periodicamente o estado de todos os clientes
  async checkAllSessions(): Promise<void> {
    for (const [userId, clientData] of this.sessions.entries()) {
      try {
        const state = await clientData.client.getState();
        this.logger.debug(`Estado do cliente ${userId}: ${state}`);

        if (!state) {
          this.logger.warn(
            `Cliente ${userId} desconectado, tentando reconectar...`,
          );
          clientData.client.initialize().catch((err) => {
            this.logger.error(`Erro ao reconectar cliente ${userId}:`, err);
          });
        }
      } catch (error) {
        this.logger.warn(
          `Erro ao verificar estado do cliente ${userId}:`,
          error,
        );
      }
    }
  }
}
