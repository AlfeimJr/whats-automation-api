import { FieldType } from '../entities/field.entity';

export class CreateFieldDto {
  label!: string;

  type!: FieldType;

  required = false;

  options?: any;

  order!: number;
}
