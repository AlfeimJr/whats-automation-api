import { Injectable, Logger } from '@nestjs/common';
import { create, Whatsapp } from 'venom-bot';
import * as fs from 'fs';
import * as path from 'path';

interface WhatsAppClientData {
  client: Whatsapp;
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

  async getClientForUser(userId: string): Promise<WhatsAppClientData> {
    if (this.sessions.has(userId)) {
      return this.sessions.get(userId);
    }
    const clientData = await this.createClient(userId);
    this.sessions.set(userId, clientData);
    return clientData;
  }

  async createClient(userId: string): Promise<WhatsAppClientData> {
    // Define o diretório da sessão (ex.: venom-sessions/{userId})
    const sessionPath = path.join(process.cwd(), 'venom-sessions', userId);
    if (!fs.existsSync(sessionPath)) {
      fs.mkdirSync(sessionPath, { recursive: true });
    }

    // Preparar uma promise para aguardar a criação do cliente
    let resolveReady: () => void;
    let rejectReady: (error?: any) => void;
    const readyPromise = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });

    const clientData: WhatsAppClientData = {
      client: null,
      clientReadyPromise: readyPromise,
      qrCode: null,
    };

    // Chamada à função create do Venom Bot com os parâmetros corretos:
    // 1º parâmetro: nome da sessão
    // 2º parâmetro: callback para capturar o QR
    // 3º parâmetro: callback para status da sessão
    // 4º parâmetro: objeto de configuração com as opções corretas
    create(
      userId, // Nome da sessão
      (qr: string, asciiQR: string, attempts: number) => {
        this.logger.log(`QR Code recebido para o usuário ${userId}`);
        // Armazena o código QR
        clientData.qrCode = qr;

        // (Opcional) Salva uma versão ASCII do QR para debug
        const filePath = path.join(sessionPath, 'qr.txt');
        fs.writeFileSync(filePath, asciiQR);
        this.logger.log(`QR Code (ASCII) salvo para ${userId} em ${filePath}`);
      },
      (statusSession: string, session: string) => {
        this.logger.log(`Status da sessão "${userId}": ${statusSession}`);
      },
      {
        headless: 'new', // Permite: false, "new" ou "old"
        logQR: true, // Deve ser booleano
      },
    )
      .then((client: Whatsapp) => {
        this.logger.log(`Venom Client está pronto para o usuário ${userId}`);
        clientData.client = client;
        // Limpa o QR quando a sessão estiver ativa
        clientData.qrCode = null;
        resolveReady();
      })
      .catch((error) => {
        this.logger.error(`Erro ao criar Venom client para ${userId}:`, error);
        rejectReady(error);
      });

    return clientData;
  }

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
    // Obtém todos os chats via getAllChats do Venom Bot
    const chats = await clientData.client.getAllChats();
    // Filtra chats de grupo
    const groupChats = chats.filter((chat) => chat.isGroup);

    const result = groupChats.map((chat: any) => ({
      id: chat.id,
      name: chat.contact?.name || chat.name || chat.id,
    }));

    this.chatCache.set(userId, {
      data: result,
      timestamp: now,
    });

    this.logger.log(
      `Chats de grupo para ${userId}: ${groupChats.length} encontrados`,
    );
    return result;
  }

  async sendMessage(userId: string, chatId: string, message: string) {
    const clientData = await this.getClientForUser(userId);
    await clientData.clientReadyPromise;
    return clientData.client.sendText(chatId, message);
  }

  async mentionEveryone(userId: string, chatId: string, message: string) {
    const clientData = await this.getClientForUser(userId);
    await clientData.clientReadyPromise;
    const chat = await clientData.client.getChatById(chatId);
    if (!chat) throw new Error('Chat não encontrado');
    if (!chat.isGroup) throw new Error('O chat não é um grupo');
    // Como o método sendTextWithMentions não consta na definição de tipos, forçamos como any:
    return (clientData.client as any).sendTextWithMentions(chatId, message);
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
    try {
      if (clientData.client) {
        await clientData.client.close();
      }
    } catch (error) {
      this.logger.warn(`Erro no processo de logout para ${userId}:`, error);
    } finally {
      this.sessions.delete(userId);
      const sessionPath = path.join(process.cwd(), 'venom-sessions', userId);
      try {
        if (fs.existsSync(sessionPath)) {
          fs.rmSync(sessionPath, { recursive: true, force: true });
          this.logger.log(`Diretório de sessão removido para ${userId}`);
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
