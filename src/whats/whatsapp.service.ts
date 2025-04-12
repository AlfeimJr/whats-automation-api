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

  // Armazena as sessões ativas pelo userId
  private sessions: Map<string, WhatsAppClientData> = new Map();

  // Cache de chats (para evitar refazer a requisição repetidamente)
  private chatCache: Map<string, { data: any[]; timestamp: number }> =
    new Map();

  // Tempo de vida do cache em milissegundos (5 minutos)
  private readonly CACHE_TTL = 5 * 60 * 1000;

  async getClientForUser(userId: string) {
    this.logger.log(`getClientForUser chamado para ${userId}`);

    if (this.sessions.has(userId)) {
      return this.sessions.get(userId);
    }
    const clientData = await this.createClient(userId);
    this.sessions.set(userId, clientData);
    return clientData;
  }

  async createClient(userId: string) {
    const dataPath = path.join(process.cwd(), '.wwebjs_auth', userId);

    // Aqui é onde adicionamos as configurações de puppeteer para exibir o Chromium (headful)
    const client = new Client({
      authStrategy: new LocalAuth({
        clientId: userId,
        dataPath,
      }),
      puppeteer: {
        headless: false, // Força a abertura do Chromium com interface gráfica
        // Em alguns ambientes de produção pode ser necessário ajustar os args, por exemplo:
        // args: ['--no-sandbox', '--disable-setuid-sandbox'],
      },
    });

    let firstQrShown = false;
    let qrExpirationTimer: NodeJS.Timeout;

    const clientData = {
      client,
      qrCode: null as string | null,
      clientReadyPromise: new Promise<void>((resolve, reject) => {
        client.on('qr', async (qr) => {
          // Se não quiser atualizar o QR a cada renovação, ignore se firstQrShown = true
          if (firstQrShown) {
            this.logger.log(`Renovação do QR ignorada p/ ${userId}`);
            return;
          }
          firstQrShown = true;

          this.logger.log(`Novo QR code p/ ${userId}`);
          try {
            const dataUrl = await QRCode.toDataURL(qr);
            clientData.qrCode = dataUrl;

            fs.mkdirSync(dataPath, { recursive: true });
            fs.writeFileSync(
              path.join(dataPath, 'qr.png'),
              dataUrl.split(',')[1],
              'base64',
            );
          } catch (err) {
            this.logger.error(`Erro ao gerar QR p/ ${userId}`, err);
          }
        });

        client.on('ready', () => {
          if (qrExpirationTimer) clearTimeout(qrExpirationTimer);
          this.logger.log(`Client [${userId}] pronto (autenticado)`);
          clientData.qrCode = null;
          resolve();
        });

        client.on('auth_failure', (msg) => {
          if (qrExpirationTimer) clearTimeout(qrExpirationTimer);
          this.logger.error(`Auth fail p/ ${userId}: ${msg}`);
          reject(msg);
        });
      }),
    };

    client.initialize();
    return clientData;
  }

  async getChats(userId: string): Promise<{ id: string; name: string }[]> {
    console.log(`getChats chamado para ${userId}`);

    const cache = this.chatCache.get(userId);
    const now = Date.now();
    if (cache && now - cache.timestamp < this.CACHE_TTL) {
      this.logger.log(`Usando cache de chats para ${userId}`);
      return cache.data;
    }
    console.log(`carregando chats`);

    // Garante que o cliente esteja pronto
    const clientData = await this.getClientForUser(userId);
    await clientData.clientReadyPromise;

    const chats = await clientData.client.getChats();
    console.log(chats);
    const groupChats = chats.filter((chat) => chat.isGroup);

    this.logger.log(
      `Encontrados ${groupChats.length} chats de grupo para o usuário ${userId}`,
    );

    const result = groupChats.map((chat) => ({
      id: chat.id._serialized,
      name: chat.name || chat.id.user,
    }));

    // Atualiza o cache
    this.chatCache.set(userId, {
      data: result,
      timestamp: now,
    });

    return result;
  }

  async sendMessage(userId: string, chatId: string, message: string) {
    const clientData = await this.getClientForUser(userId);
    await clientData.clientReadyPromise;
    return clientData.client.sendMessage(chatId, message);
  }

  async mentionEveryone(userId: string, chatId: string, message: string) {
    const clientData = await this.getClientForUser(userId);
    await clientData.clientReadyPromise;

    const chat = await clientData.client.getChatById(chatId);
    if (!chat) throw new Error(`Chat ${chatId} não encontrado para ${userId}`);
    if (!chat.isGroup) {
      throw new Error(`O chat ${chatId} não é um grupo para ${userId}`);
    }

    const groupChat = chat as any; // cast para acessar participants
    const mentions = groupChat.participants.map(
      (participant: any) => participant.id._serialized,
    );

    return clientData.client.sendMessage(chatId, message, { mentions });
  }

  async getQRCode(userId: string): Promise<{ qr?: string; ready?: boolean }> {
    const clientData = await this.getClientForUser(userId);
    if (clientData.qrCode) {
      return { qr: clientData.qrCode };
    }
    return { ready: true };
  }

  /**
   * Efetua logout do usuário, mas NÃO remove arquivos de sessão em disco,
   * e NÃO fecha o navegador Puppeteer explicitamente. Pode deixar processos
   * abertos, dependendo do fluxo que você deseja.
   */
  async logout(userId: string): Promise<void> {
    if (!this.sessions.has(userId)) {
      this.logger.warn(`Tentativa de logout de userId inexistente: ${userId}`);
      return;
    }

    const clientData = this.sessions.get(userId);

    try {
      // Se o client já estiver iniciado e autenticado, tentamos logout
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
      this.logger.warn(`Erro no processo de logout para ${userId}:`, error);
    } finally {
      try {
        // Se quiser encerrar totalmente a sessão em memória (mas não remover do disco):
        if (clientData.client) {
          await clientData.client.destroy();
        }
        this.logger.log(`Cliente destruído (memória) para o usuário ${userId}`);
      } catch (destroyError) {
        this.logger.warn(
          `Erro ao destruir cliente para ${userId}:`,
          destroyError,
        );
      }

      // Remove a sessão do mapa, mas não remove a pasta local
      this.sessions.delete(userId);

      // --- Abaixo removido: não vamos apagar a pasta de sessão ---
      // // if (fs.existsSync(dataPath)) {
      // //   fs.rmSync(dataPath, { recursive: true, force: true });
      // //   this.logger.log(`Diretório de sessão removido para ${userId}`);
      // // }
    }
  }
}
