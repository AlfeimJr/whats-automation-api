import { Injectable, Logger } from '@nestjs/common';
import { Client, LocalAuth, Message } from 'whatsapp-web.js';
import * as fs from 'fs';
import * as path from 'path';
import * as QRCode from 'qrcode';
import axios from 'axios';

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

  /** Cria ou retorna uma instância LocalAuth isolada por usuário */
  private getAuthStrategy(userId: string): LocalAuth {
    const sessionDir = path.join(process.cwd(), 'whatsapp-sessions', userId);
    fs.mkdirSync(sessionDir, { recursive: true });
    return new LocalAuth({
      clientId: userId,
      dataPath: sessionDir, // estado de auth e sessão aqui
    });
  }

  /** Garante apenas uma criação concorrente de cliente por usuário */
  async getClientForUser(userId: string): Promise<WhatsAppClientData> {
    this.logger.log(`getClientForUser chamado para ${userId}`);
    if (this.sessions.has(userId)) {
      return this.sessions.get(userId)!;
    }
    // placeholder para bloquear chamadas concorrentes
    this.sessions.set(userId, {} as WhatsAppClientData);
    const clientData = await this.createClient(userId);
    this.sessions.set(userId, clientData);
    return clientData;
  }

  /** Cria a instância do Client, QR code e listeners isolados por usuário */
  private async createClient(userId: string): Promise<WhatsAppClientData> {
    const sessionDir = path.join(process.cwd(), 'whatsapp-sessions', userId);
    const qrDir = path.join(sessionDir, 'qr');

    const client = new Client({
      authStrategy: this.getAuthStrategy(userId),
      puppeteer: { headless: true, dumpio: true },
    });

    let firstQrShown = false;
    let qrExpirationTimer: NodeJS.Timeout;

    const clientData: WhatsAppClientData = {
      client,
      qrCode: null,
      clientReadyPromise: new Promise<void>((resolve, reject) => {
        client.on('qr', async (qr) => {
          if (firstQrShown) {
            this.logger.log(`Ignorando renovação de QR para ${userId}`);
            return;
          }
          firstQrShown = true;
          this.logger.log(`Novo QR gerado para ${userId}`);
          try {
            const base64 = await QRCode.toDataURL(qr);
            clientData.qrCode = base64;
            fs.mkdirSync(qrDir, { recursive: true });
            fs.writeFileSync(path.join(qrDir, 'qr_base64.txt'), base64, 'utf8');
            this.logger.log(`QR salvo em Base64 para ${userId}`);
            qrExpirationTimer = setTimeout(() => {
              this.logger.log(`QR expirado para ${userId}`);
              clientData.qrCode = null;
              firstQrShown = false;
            }, 2 * 60 * 1000);
          } catch (err) {
            this.logger.error(`Erro ao gerar QR para ${userId}`, err);
            try {
              fs.mkdirSync(qrDir, { recursive: true });
              fs.writeFileSync(path.join(qrDir, 'qr_raw.txt'), qr, 'utf8');
            } catch {
              this.logger.error(`Falha ao salvar QR raw para ${userId}`);
            }
            clientData.qrCode = `Escaneie: ${qr.slice(0, 20)}...`;
          }
        });

        client.on('ready', () => {
          if (qrExpirationTimer) clearTimeout(qrExpirationTimer);
          this.logger.log(`Cliente pronto para ${userId}`);
          client.on('message', async (msg: Message) => {
            if (msg.fromMe) return; // ignora mensagens próprias
            if (!msg.body.startsWith('/ai ')) return; // só processa /ai
            const prompt = msg.body.slice(4);
            this.logger.log(`Prompt IA de ${userId}: ${prompt}`);
            try {
              const reply = await this.getChatGptResponse(prompt);
              await msg.reply(reply);
            } catch (e) {
              this.logger.error(`Erro IA para ${userId}`, e);
              await msg.reply('Desculpe, falha ao processar seu pedido.');
            }
          });
          resolve();
        });

        client.on('auth_failure', (msg) => {
          if (qrExpirationTimer) clearTimeout(qrExpirationTimer);
          this.logger.error(`Falha de auth em ${userId}: ${msg}`);
          reject(new Error(msg));
        });

        client.on('disconnected', (reason) => {
          this.logger.warn(`Desconectado ${userId}: ${reason}`);
          if (qrExpirationTimer) clearTimeout(qrExpirationTimer);
        });
      }),
    };

    client.initialize();
    return clientData;
  }

  /** Chama OpenAI para obter resposta */
  private async getChatGptResponse(prompt: string): Promise<string> {
    const res = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o-mini',
        store: true,
        messages: [
          {
            role: 'system',
            content: 'Você é um assistente virtual para agendamentos.',
          },
          { role: 'user', content: prompt },
        ],
        max_tokens: 150,
        temperature: 0.7,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer YOUR_OPENAI_KEY`,
        },
      },
    );
    return res.data.choices[0].message.content.trim();
  }

  /** Lista apenas grupos, com cache de 5 minutos */
  async getChats(userId: string): Promise<{ id: string; name: string }[]> {
    const now = Date.now();
    const cached = this.chatCache.get(userId);
    if (cached && now - cached.timestamp < this.CACHE_TTL) {
      this.logger.log(`Cache de chats para ${userId}`);
      return cached.data;
    }
    const { client, clientReadyPromise } = await this.getClientForUser(userId);
    await clientReadyPromise;
    const chats = await client.getChats();
    const groups = chats
      .filter((c) => c.isGroup)
      .map((c) => ({
        id: c.id._serialized,
        name: c.name || c.id.user,
      }));
    this.chatCache.set(userId, { data: groups, timestamp: now });
    this.logger.log(`Encontrados ${groups.length} grupos para ${userId}`);
    return groups;
  }

  /** Envia mensagem simples */
  async sendMessage(userId: string, chatId: string, message: string) {
    const { client, clientReadyPromise } = await this.getClientForUser(userId);
    await clientReadyPromise;
    return client.sendMessage(chatId, message);
  }

  /** Menciona todo mundo no grupo */
  async mentionEveryone(userId: string, chatId: string, message: string) {
    const { client, clientReadyPromise } = await this.getClientForUser(userId);
    await clientReadyPromise;
    const chat = await client.getChatById(chatId);
    if (!chat || !chat.isGroup) throw new Error(`Chat ${chatId} não é grupo.`);
    const mentions = (chat as any).participants.map(
      (p: any) => p.id._serialized,
    );
    return client.sendMessage(chatId, message, { mentions });
  }

  /** Obtém QR code Base64 enquanto não autenticado */
  async getQRCode(userId: string): Promise<string> {
    const { client, clientReadyPromise, qrCode } = await this.getClientForUser(
      userId,
    );
    let attempts = 0;
    while (!client.info && !qrCode && attempts++ < 10) {
      await new Promise((res) => setTimeout(res, 1000));
    }
    return client.info ? '' : qrCode || '';
  }

  /** Logout e limpeza de arquivos de sessão */
  async logout(userId: string): Promise<void> {
    if (!this.sessions.has(userId)) {
      this.logger.warn(`Logout: userId ${userId} não existe`);
      return;
    }
    const { client } = this.sessions.get(userId)!;
    try {
      if (client.info) {
        await Promise.race([
          client.logout(),
          new Promise((_, rej) =>
            setTimeout(() => rej(new Error('Logout timeout')), 10000),
          ),
        ]);
      }
    } catch (e) {
      this.logger.warn(`Erro no logout de ${userId}`, e);
    }
    try {
      await client.destroy();
      this.logger.log(`Cliente destruído para ${userId}`);
    } catch (e) {
      this.logger.warn(`Erro destroy ${userId}`, e);
    }
    this.sessions.delete(userId);
    // remove pasta de sessão
    const sessionDir = path.join(process.cwd(), 'whatsapp-sessions', userId);
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }

  /** Status de conexão */
  async getConnectionStatus(
    userId: string,
  ): Promise<'connected' | 'disconnected' | 'error'> {
    try {
      const { client } = await this.getClientForUser(userId);
      return client.info ? 'connected' : 'disconnected';
    } catch {
      return 'error';
    }
  }
}
