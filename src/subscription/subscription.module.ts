import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SubscriptionController } from './subscription.controller';
import { SubscriptionService } from './subscription.service';
import { SubscriptionPlan } from './entities/subscription-plan.entity';
import { UserSubscription } from './entities/user-subscription.entity';
import { Payment } from '../payment/entities/payment.entity';
import { PixService } from '../payment/pix.service';
import { User } from '../user/entities/user.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SubscriptionPlan,
      UserSubscription,
      Payment,
      User,
    ]),
  ],
  controllers: [SubscriptionController],
  providers: [SubscriptionService, PixService],
  exports: [SubscriptionService],
})
export class SubscriptionModule {}
