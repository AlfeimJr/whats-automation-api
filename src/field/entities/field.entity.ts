// src/modules/forms/entities/field.entity.ts
import { Form } from 'src/form/entities/form.entity';
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne } from 'typeorm';

export enum FieldType {
  TEXT = 'text',
  NUMBER = 'number',
  DATE = 'date',
  SELECT = 'select',
  CHECKBOX = 'checkbox',
}

@Entity()
export class Field {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  label!: string;

  @Column({ type: 'enum', enum: FieldType })
  type!: FieldType;

  @Column({ default: false })
  required!: boolean;

  @Column('jsonb', { nullable: true })
  options?: any; // p/ SELECT/checkbox (guardar array ou objeto de opções)

  @Column()
  order!: number;

  @ManyToOne(() => Form, (form) => form.fields, { onDelete: 'CASCADE' })
  form!: Form;
}
