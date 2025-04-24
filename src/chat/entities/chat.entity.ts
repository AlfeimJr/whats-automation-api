import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity()
export class Chat {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // ID recebido do WhatsApp
  @Column({ unique: true })
  chatId: string;

  // Nome do grupo ou chat
  @Column()
  name: string;

  @CreateDateColumn()
  createdAt: Date;
}
