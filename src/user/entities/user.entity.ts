import { Exclude } from 'class-transformer';
import { UserSubscription } from 'src/subscription/entities/user-subscription.entity';
import {
  Column,
  Entity,
  OneToMany,
  PrimaryColumn,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity()
export class User {
  @PrimaryColumn({ type: 'uuid' })
  id: string;

  @Column()
  name: string;

  @Column()
  email: string;

  @Column()
  @Exclude()
  password: string;

  @Column({ default: 0 })
  role?: number;

  @Column({ default: false })
  hasActiveSubscription: boolean;

  @Column({ nullable: true })
  currentSubscriptionId: string;

  @OneToMany(() => UserSubscription, (subscription) => subscription.user)
  subscriptions: UserSubscription[];
  constructor(partial: Partial<User>) {
    Object.assign(this, partial);
  }
}
