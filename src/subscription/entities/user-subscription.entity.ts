import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from '../../user/entities/user.entity';
import { SubscriptionPlan } from './subscription-plan.entity';

@Entity()
export class UserSubscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn()
  user: User;

  @Column()
  userId: string;

  @ManyToOne(() => SubscriptionPlan)
  @JoinColumn()
  plan: SubscriptionPlan;

  @Column()
  planId: string;

  @Column()
  startDate: Date;

  @Column()
  endDate: Date;

  @Column({ default: false })
  isActive: boolean;
}
