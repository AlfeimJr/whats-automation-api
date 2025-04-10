// src/whatsapp/whatsapp.module.ts
import { Module } from '@nestjs/common';

import { WhatsAppController } from './whats.controller';
import { WhatsappSessionManagerService } from './whatsapp.service';

@Module({
  providers: [WhatsappSessionManagerService],
  controllers: [WhatsAppController],
  exports: [WhatsappSessionManagerService], // Caso queira usar o serviço em outros módulos
})
export class WhatsAppModule {}
