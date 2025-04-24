import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Payment } from './entities/payment.entity';
import { PixService } from './pix.service';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [TypeOrmModule.forFeature([Payment]), ConfigModule],
  providers: [PixService],
  exports: [PixService],
})
export class PaymentModule {}
