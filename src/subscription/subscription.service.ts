import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserSubscription } from './entities/user-subscription.entity';
import { SubscriptionPlan } from './entities/subscription-plan.entity';
import { User } from '../user/entities/user.entity';
import { Payment, PaymentStatus } from '../payment/entities/payment.entity';
import { PixService } from '../payment/pix.service';

@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    @InjectRepository(UserSubscription)
    private userSubscriptionRepository: Repository<UserSubscription>,
    @InjectRepository(SubscriptionPlan)
    private subscriptionPlanRepository: Repository<SubscriptionPlan>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(Payment)
    private paymentRepository: Repository<Payment>,
    private pixService: PixService,
  ) {}

  async getAvailablePlans(): Promise<SubscriptionPlan[]> {
    return this.subscriptionPlanRepository.find({ where: { isActive: true } });
  }

  async createSubscription(
    userId: string,
    planId: string,
  ): Promise<{
    subscription: UserSubscription;
    payment: Payment;
  }> {
    // Buscar usuário e plano
    const user = await this.userRepository.findOne({ where: { id: userId } });
    const plan = await this.subscriptionPlanRepository.findOne({
      where: { id: planId },
    });

    if (!user || !plan) {
      throw new Error('Usuário ou plano não encontrado');
    }

    // Criar assinatura (inicialmente inativa)
    const subscription = new UserSubscription();
    subscription.userId = userId;
    subscription.planId = planId;
    subscription.startDate = new Date();

    // Calcular data de término
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + plan.durationDays);
    subscription.endDate = endDate;

    subscription.isActive = false;

    await this.userSubscriptionRepository.save(subscription);

    // Gerar pagamento PIX
    const pixData = await this.pixService.generatePixPayment(
      userId,
      plan.price,
      `Assinatura: ${plan.name}`,
    );

    // Criar registro de pagamento
    const payment = new Payment();
    payment.userId = userId;
    payment.subscriptionId = subscription.id;
    payment.amount = plan.price;
    payment.status = PaymentStatus.PENDING;
    payment.pixCode = pixData.pixCode;
    payment.pixQrCodeImage = pixData.qrCodeImage;
    payment.expirationDate = pixData.expirationDate;

    await this.paymentRepository.save(payment);

    return { subscription, payment };
  }

  async checkAndUpdateSubscriptionStatus(paymentId: string): Promise<boolean> {
    const payment = await this.paymentRepository.findOne({
      where: { id: paymentId },
      relations: ['subscription'],
    });

    if (!payment) {
      throw new Error('Pagamento não encontrado');
    }

    // Verificar status do pagamento na API do PIX
    const isPaid = await this.pixService.checkPaymentStatus(payment.pixCode);

    if (isPaid && payment.status !== PaymentStatus.COMPLETED) {
      // Atualizar status do pagamento
      payment.status = PaymentStatus.COMPLETED;
      payment.paymentDate = new Date();
      await this.paymentRepository.save(payment);

      // Ativar a assinatura
      if (payment.subscriptionId) {
        const subscription = await this.userSubscriptionRepository.findOne({
          where: { id: payment.subscriptionId },
        });

        if (subscription) {
          subscription.isActive = true;
          await this.userSubscriptionRepository.save(subscription);

          // Atualizar status no usuário
          await this.userRepository.update(
            { id: payment.userId },
            {
              hasActiveSubscription: true,
              currentSubscriptionId: subscription.id,
            },
          );

          return true;
        }
      }
    }

    return false;
  }

  async isUserSubscriptionActive(userId: string): Promise<boolean> {
    const user = await this.userRepository.findOne({ where: { id: userId } });

    if (!user) {
      return false;
    }

    return user.hasActiveSubscription;
  }
}
