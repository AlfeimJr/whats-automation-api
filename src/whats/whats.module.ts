import { Module } from '@nestjs/common';
import { WhatsController } from './whats.controller';
import { WhatsappSessionManagerService } from './whatsapp.service';
import { SubscriptionModule } from 'src/subscription/subscription.module';

@Module({
  imports: [SubscriptionModule],
  controllers: [WhatsController],
  providers: [WhatsappSessionManagerService],
  exports: [WhatsappSessionManagerService],
})
export class WhatsAppModule {}
