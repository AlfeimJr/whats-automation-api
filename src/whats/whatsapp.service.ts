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
      client,
      clientReadyPromise: null,
      qrCode: null,
    };

    // Flag para garantir que o QR code seja definido apenas uma vez
    let qrGenerated = false;

    clientData.clientReadyPromise = new Promise<void>((resolve, reject) => {
      // Evento de QR code: atualiza somente se ainda não foi gerado.
      client.on('qr', async (qr) => {
        if (qrGenerated) {
          return;
        }
        this.logger.log(`QR Code recebido para o usuário ${userId}: ${qr}`);
        try {
          const dataUrl = await QRCode.toDataURL(qr);
          clientData.qrCode = dataUrl;
          qrGenerated = true;
          // Opcional: salva o QR code em disco
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

      // Quando o cliente estiver pronto, limpa o QR code e resolve a promise
      client.on('ready', () => {
        this.logger.log(`WhatsApp Client está pronto para o usuário ${userId}`);
        clientData.qrCode = null; // Sessão autenticada, nenhum QR code é necessário
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

  /**
   * Retorna somente os chats de grupo para um usuário.
   */
  async getChats(userId: string): Promise<{ id: string; name: string }[]> {
    const clientData = await this.getClientForUser(userId);
    await clientData.clientReadyPromise;
    const chats = await clientData.client.getChats();
    // Filtra apenas os chats que são grupos
    const groupChats = chats.filter((chat) => chat.isGroup);
    this.logger.log(
      `Chats de grupo para ${userId}: ${groupChats.length} encontrados`,
    );
    return groupChats.map((chat) => ({
      id: chat.id._serialized,
      name: chat.name || chat.id.user,
    }));
  }

  /**
   * Envia uma mensagem comum para um chat específico para o usuário.
   */
  async sendMessage(userId: string, chatId: string, message: string) {
    const clientData = await this.getClientForUser(userId);
    await clientData.clientReadyPromise;
    const chat = await clientData.client.getChatById(chatId);
    if (!chat) throw new Error('Chat não encontrado');
    return chat.sendMessage(message);
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
    const groupChat = chat as GroupChat;
    if (!groupChat.participants)
      throw new Error('Participantes não disponíveis');
    const mentionJids = groupChat.participants.map((p) => p.id._serialized);
    return chat.sendMessage(message, { mentions: mentionJids });
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

  /**
   * Realiza o logout do usuário, destruindo a instância do client e removendo os dados da sessão.
   */
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
      // Se o client estiver em um estado válido, tenta o logout com timeout
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
        // Destrói a instância do client
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
      // Remove a instância do mapa para forçar a criação de uma nova sessão no próximo acesso
      this.sessions.delete(userId);
      // Remove os arquivos de sessão
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
