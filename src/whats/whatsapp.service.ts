import { Injectable, Logger } from '@nestjs/common';
import { Client, LocalAuth } from 'whatsapp-web.js';
import * as fs from 'fs';
import * as path from 'path';
import * as QRCode from 'qrcode';

interface WhatsAppClientData {
  client: Client;
  clientReadyPromise: Promise<void>;
  qrCode: string | null;
}

@Injectable()
export class WhatsappSessionManagerService {
  private readonly logger = new Logger(WhatsappSessionManagerService.name);
  // Mapa para gerenciar clientes separados por usuário
  private sessions: Map<string, WhatsAppClientData> = new Map();
  // Cache para os chats, se for necessário para reduzir chamadas à API
  private chatCache: Map<string, { data: any[]; timestamp: number }> =
    new Map();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutos

  /**
   * Retorna o cliente associado ao usuário. Se não existir, cria uma nova instância.
   */
  async getClientForUser(userId: string): Promise<WhatsAppClientData> {
    this.logger.log(`getClientForUser chamado para ${userId}`);
    if (this.sessions.has(userId)) {
      return this.sessions.get(userId)!;
    }
    const clientData = await this.createClient(userId);
    this.sessions.set(userId, clientData);
    return clientData;
  }

  /**
   * Cria o cliente do WhatsApp para o usuário e configura os eventos de QR, ready,
   * auth_failure e disconnected. Cada instância usa um diretório exclusivo para salvar
   * os QR codes, sem interferir nos dados de autenticação (LocalAuth).
   */
  async createClient(userId: string): Promise<WhatsAppClientData> {
    // Diretório para salvar os arquivos de QR code, separado do diretório de autenticação
    const qrDataPath = path.join(process.cwd(), '.wwebjs_qr', userId);

    // A estratégia de autenticação do whatsapp-web.js já isola os dados por usuário
    const client = new Client({
      authStrategy: new LocalAuth({ clientId: userId }),
      puppeteer: {
        headless: true,
        dumpio: true,
      },
    });

    // Flag para impedir que QR codes sejam substituídos antes de expirar
    let firstQrShown = false;
    let qrExpirationTimer: NodeJS.Timeout;
    const clientData: WhatsAppClientData = {
      client,
      qrCode: null,
      clientReadyPromise: new Promise<void>((resolve, reject) => {
        // Evento emitido quando é gerado um novo QR
        client.on('qr', async (qr: string) => {
          // Se já houve um QR gerado e não expirou, ignora o novo evento
          if (firstQrShown) {
            this.logger.log(`Renovação do QR ignorada para ${userId}`);
            return;
          }
          firstQrShown = true;
          this.logger.log(`Novo QR code para ${userId}`);
          try {
            const asciiQr = await QRCode.toString(qr, {
              type: 'utf8',
              small: true,
            });
            clientData.qrCode = asciiQr;
            // Cria a pasta exclusiva para os arquivos de QR code
            fs.mkdirSync(qrDataPath, { recursive: true });
            fs.writeFileSync(path.join(qrDataPath, 'qr.txt'), asciiQr, 'utf8');
            fs.writeFileSync(path.join(qrDataPath, 'qr_data.txt'), qr, 'utf8');

            this.logger.log(`QR code ASCII gerado e salvo para ${userId}`);
            // Define um timer para expirar o QR após 2 minutos e reiniciar o flag
            qrExpirationTimer = setTimeout(() => {
              if (clientData.qrCode) {
                this.logger.log(`QR code expirado para ${userId}`);
                clientData.qrCode = null;
                // Permite a renovação do QR após expirar
                firstQrShown = false;
              }
            }, 2 * 60 * 1000);
          } catch (err) {
            this.logger.error(`Erro ao gerar QR para ${userId}`, err);
            try {
              fs.mkdirSync(qrDataPath, { recursive: true });
              fs.writeFileSync(
                path.join(qrDataPath, 'qr_data.txt'),
                qr,
                'utf8',
              );
            } catch (fsErr) {
              this.logger.error(`Erro ao salvar QR data para ${userId}`, fsErr);
            }
            clientData.qrCode = `Escaneie este código: ${qr.substring(
              0,
              20,
            )}...`;
          }
        });

        // Evento emitido quando o cliente está autenticado e pronto para uso
        client.on('ready', () => {
          if (qrExpirationTimer) clearTimeout(qrExpirationTimer);
          this.logger.log(`Cliente [${userId}] pronto (autenticado)`);
          resolve();
        });

        // Evento emitido em caso de falha na autenticação
        client.on('auth_failure', (msg) => {
          if (qrExpirationTimer) clearTimeout(qrExpirationTimer);
          this.logger.error(`Falha de autenticação para ${userId}: ${msg}`);
          reject(msg);
        });

        // Se o cliente for desconectado, limpa o timer de QR
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

  /**
   * Retorna a lista de chats (apenas grupos) do usuário. Utiliza cache para reduzir
   * chamadas, respeitando o tempo de expiração definido.
   */
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

  /**
   * Envia mensagem para um determinado chat.
   */
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

  /**
   * Menciona todos os participantes de um grupo, enviando uma mensagem com as menções.
   */
  async mentionEveryone(userId: string, chatId: string, message: string) {
    try {
      const clientData = await this.getClientForUser(userId);
      await clientData.clientReadyPromise;
      const chat = await clientData.client.getChatById(chatId);
      if (!chat)
        throw new Error(`Chat ${chatId} não encontrado para ${userId}`);
      if (!chat.isGroup)
        throw new Error(`Chat ${chatId} não é um grupo para ${userId}`);

      // Extraindo os participantes para gerar as menções
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

  /**
   * Retorna o QR code (em formato ASCII) caso o cliente ainda não esteja autenticado.
   */
  async getQRCode(userId: string): Promise<string> {
    try {
      const clientData = await this.getClientForUser(userId);
      let attempts = 0;
      // Aguarda que ou o cliente seja autenticado ou que o QR esteja disponível
      while (!clientData.client.info && !clientData.qrCode && attempts < 10) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        attempts++;
      }
      if (!clientData.client.info && clientData.qrCode) {
        return clientData.qrCode;
      }
      return '';
    } catch (error) {
      this.logger.error(`Erro ao obter QR code para ${userId}`, error);
      throw error;
    }
  }

  /**
   * Realiza o logout do cliente, destruindo a instância e removendo-a do gerenciador de sessões.
   */
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

  /**
   * Retorna o status da conexão do cliente para o usuário.
   */
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
