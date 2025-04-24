import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SubscriptionService } from './subscription.service';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';

@ApiTags('Subscription')
@Controller('subscription')
export class SubscriptionController {
  constructor(private subscriptionService: SubscriptionService) {}

  @Get('plans')
  @ApiOperation({ summary: 'Listar planos disponíveis' })
  getPlans() {
    return this.subscriptionService.getAvailablePlans();
  }

  @UseGuards(JwtAuthGuard)
  @Post('subscribe/:planId')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Assinar um plano' })
  subscribe(@Param('planId') planId: string, @Body('userId') userId: string) {
    return this.subscriptionService.createSubscription(userId, planId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('status')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Verificar status da assinatura' })
  checkStatus(@Body('userId') userId: string) {
    return this.subscriptionService.isUserSubscriptionActive(userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('check-payment/:paymentId')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Verificar status do pagamento' })
  checkPayment(@Param('paymentId') paymentId: string) {
    return this.subscriptionService.checkAndUpdateSubscriptionStatus(paymentId);
  }
}
