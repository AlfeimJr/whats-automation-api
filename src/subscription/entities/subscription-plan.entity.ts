import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity()
export class SubscriptionPlan {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column()
  description: string;

  @Column('decimal', { precision: 10, scale: 2 })
  price: number;

  @Column()
  durationDays: number;

  @Column({ default: true })
  isActive: boolean;
}
