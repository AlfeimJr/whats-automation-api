import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { Payment } from './entities/payment.entity';

@Injectable()
export class PixService {
  private readonly logger = new Logger(PixService.name);
  private readonly apiKey: string;
  private readonly apiUrl: string;

  constructor(private configService: ConfigService) {
    this.apiKey = this.configService.get<string>('PIX_API_KEY');
    this.apiUrl = this.configService.get<string>('PIX_API_URL');
  }

  async generatePixPayment(
    userId: string,
    amount: number,
    description: string,
  ): Promise<{
    pixCode: string;
    qrCodeImage: string;
    expirationDate: Date;
  }> {
    try {
      // Aqui você integraria com uma API de PIX real
      // Este é um exemplo simulado
      const expirationDate = new Date();
      expirationDate.setHours(expirationDate.getHours() + 1); // Expira em 1 hora

      const response = await axios.post(
        `${this.apiUrl}/pix/create`,
        {
          amount,
          description,
          expirationDate,
          reference: userId,
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
        },
      );

      return {
        pixCode: response.data.pixCode,
        qrCodeImage: response.data.qrCodeImage,
        expirationDate,
      };
    } catch (error) {
      this.logger.error(`Erro ao gerar pagamento PIX: ${error.message}`);
      throw new Error('Falha ao gerar pagamento PIX');
    }
  }

  async checkPaymentStatus(pixCode: string): Promise<boolean> {
    try {
      // Integração real com API de PIX para verificar status
      const response = await axios.get(`${this.apiUrl}/pix/status/${pixCode}`, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      });

      return response.data.status === 'COMPLETED';
    } catch (error) {
      this.logger.error(
        `Erro ao verificar status do pagamento: ${error.message}`,
      );
      return false;
    }
  }
}
