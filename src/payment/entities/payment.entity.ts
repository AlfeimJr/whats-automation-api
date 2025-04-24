import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from '../../user/entities/user.entity';
import { UserSubscription } from '../../subscription/entities/user-subscription.entity';

export enum PaymentStatus {
  PENDING = 'pending',
  COMPLETED = 'completed',
  FAILED = 'failed',
  EXPIRED = 'expired',
}

@Entity()
export class Payment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User)
  @JoinColumn()
  user: User;

  @Column()
  userId: string;

  @ManyToOne(() => UserSubscription, { nullable: true })
  @JoinColumn()
  subscription: UserSubscription;

  @Column({ nullable: true })
  subscriptionId: string;

  @Column('decimal', { precision: 10, scale: 2 })
  amount: number;

  @Column({
    type: 'enum',
    enum: PaymentStatus,
    default: PaymentStatus.PENDING,
  })
  status: PaymentStatus;

  @Column()
  pixCode: string;

  @Column({ nullable: true })
  pixQrCodeImage: string;

  @Column()
  expirationDate: Date;

  @Column({ nullable: true })
  paymentDate: Date;

  @Column({ type: 'json', nullable: true })
  transactionData: Record<string, any>;
}
