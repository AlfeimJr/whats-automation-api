// src/modules/forms/dtos/create-form.dto.ts
import { Type } from 'class-transformer';
import { FormType } from '../enums/form-type.enum';
import { CreateFieldDto } from 'src/field/dtos/create-field.dto';

export class CreateFormDto {
  name!: string;

  type!: FormType;

  description?: string;

  @Type(() => CreateFieldDto)
  fields!: CreateFieldDto[];
}
