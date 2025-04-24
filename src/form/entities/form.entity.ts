// src/modules/forms/entities/form.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  CreateDateColumn,
  JoinColumn,
} from 'typeorm';

import { FormType } from '../enums/form-type.enum';
import { Field } from 'src/field/entities/field.entity';
import { User } from 'src/user/entities/user.entity';

@Entity()
export class Form {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ length: 120 })
  name!: string;

  @Column({ type: 'enum', enum: FormType })
  type!: FormType;

  @Column('text', { nullable: true })
  description?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Column()
  userId!: string;

  @OneToMany(() => Field, (field) => field.form, { cascade: true })
  fields!: Field[];
}
