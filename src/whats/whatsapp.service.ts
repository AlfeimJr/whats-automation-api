import { Injectable, Logger } from '@nestjs/common';
import { Client, LocalAuth } from 'whatsapp-web.js';
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
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutos

  /**
   * Retorna (ou cria, se não existir) uma instância do WhatsApp para o usuário.
   * Cada usuário terá uma instância única identificada pelo seu userId.
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
   * Utilizamos o userId para definir o clientId e o dataPath (diretório de sessão), garantindo uma sessão exclusiva.
   */
  async createClient(userId: string): Promise<WhatsAppClientData> {
    // Define o caminho para salvar os dados da sessão para esse usuário
    const dataPath = path.join(process.cwd(), '.wwebjs_auth', userId);

    // Cria o client com LocalAuth utilizando um clientId único (o próprio userId)
    const client = new Client({
      authStrategy: new LocalAuth({
        clientId: userId,
        dataPath: dataPath,
      }),
    });

    const clientData: WhatsAppClientData = {
      client: client,
      qrCode: null,
      clientReadyPromise: new Promise<void>((resolve, reject) => {
        client.on('qr', async (qr) => {
          this.logger.log(`QR Code recebido para o usuário ${userId}: ${qr}`);
          try {
            const dataUrl = await QRCode.toDataURL(qr);
            clientData.qrCode = dataUrl;
            // Salva a imagem em disco
            const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
            fs.mkdirSync(dataPath, { recursive: true });
            const filePath = path.join(dataPath, 'qr.png');
            fs.writeFileSync(filePath, base64Data, 'base64');
            this.logger.log(`QR Code salvo para ${userId} em ${filePath}`);
          } catch (error) {
            if (error.message.includes('Target closed')) {
              this.logger.error(
                `A página foi fechada antes que o QR pudesse ser gerado para ${userId}`,
              );
            } else {
              this.logger.error(`Erro ao gerar QR code para ${userId}:`, error);
            }
          }
        });

        client.on('ready', () => {
          this.logger.log(
            `WhatsApp Client está pronto para o usuário ${userId}`,
          );
          clientData.qrCode = null; // Limpa o QR code, indicando que a sessão foi autenticada
          resolve();
        });

        client.on('auth_failure', (msg) => {
          this.logger.error(`Falha na autenticação para ${userId}: ${msg}`);
          reject(msg);
        });
      }),
    };

    client.initialize();
    return clientData;
  }

  /**
   * Retorna somente os chats de grupo para um usuário.
   */
  async getChats(userId: string): Promise<{ id: string; name: string }[]> {
    // Verifica cache
    const cache = this.chatCache.get(userId);
    const now = Date.now();
    if (cache && now - cache.timestamp < this.CACHE_TTL) {
      this.logger.log(`Usando cache de chats para ${userId}`);
      return cache.data;
    }

    const clientData = await this.getClientForUser(userId);
    await clientData.clientReadyPromise;
    const chats = await clientData.client.getChats();
    // Filtra apenas os chats que são grupos
    const groupChats = chats.filter((chat) => chat.isGroup);
    console.log(groupChats);

    const result = groupChats.map((chat) => ({
      id: chat.id._serialized,
      name: chat.name || chat.id.user,
    }));

    // Atualiza o cache antes de retornar o resultado
    this.chatCache.set(userId, {
      data: result,
      timestamp: now,
    });

    this.logger.log(
      `Chats de grupo para ${userId}: ${groupChats.length} encontrados`,
    );
    return result;
  }

  /**
   * Envia uma mensagem comum para um chat específico para o usuário.
   */
  async sendMessage(userId: string, chatId: string, message: string) {
    const clientData = await this.getClientForUser(userId);
    await clientData.clientReadyPromise;
    return clientData.client.sendMessage(chatId, message);
  }

  /**
   * Envia uma mensagem mencionando todos os participantes de um grupo para o usuário.
   */
  async mentionEveryone(userId: string, chatId: string, message: string) {
    const clientData = await this.getClientForUser(userId);
    await clientData.clientReadyPromise;
    const chat = await clientData.client.getChatById(chatId);
    if (!chat) throw new Error('Chat não encontrado');
    if (!chat.isGroup) throw new Error('O chat não é um grupo');
    // Como o método sendTextWithMentions não consta na definição de tipos, forçamos como any:
    return (clientData.client as any).sendTextWithMentions(chatId, message);
  }

  /**
   * Retorna o QR code atual para um usuário, se houver. Caso contrário, indica que o client está pronto.
   */
  async getQRCode(userId: string): Promise<{ qr?: string; ready?: boolean }> {
    const clientData = await this.getClientForUser(userId);
    if (clientData.qrCode) {
      return { qr: clientData.qrCode };
    }
    return { ready: true };
  }

  async logout(userId: string): Promise<void> {
    // Verifica se existe uma sessão para este usuário
    if (!this.sessions.has(userId)) {
      this.logger.warn(
        `Tentativa de logout para usuário inexistente: ${userId}`,
      );
      return;
    }

    const clientData = this.sessions.get(userId);
    const dataPath = path.join(process.cwd(), '.wwebjs_auth', userId);

    try {
      // Verifica se o cliente está em um estado válido antes de tentar logout
      if (clientData.client && clientData.client.info) {
        // Tenta fazer logout com timeout para evitar bloqueio
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
        // Sempre tenta destruir o cliente, independente do resultado do logout
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

      // Remove a sessão do mapa antes de tentar excluir os arquivos
      this.sessions.delete(userId);

      // Tenta remover os arquivos da sessão
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
