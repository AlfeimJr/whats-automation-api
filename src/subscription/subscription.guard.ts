import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { SubscriptionService } from './subscription.service';

@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(private subscriptionService: SubscriptionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const userId = request.user?.userId;

    if (!userId) {
      throw new UnauthorizedException('Usuário não autenticado');
    }

    const hasActiveSubscription =
      await this.subscriptionService.isUserSubscriptionActive(userId);

    if (!hasActiveSubscription) {
      throw new UnauthorizedException(
        'Assinatura inativa ou inexistente. Por favor, assine um plano para continuar.',
      );
    }

    return true;
  }
}
