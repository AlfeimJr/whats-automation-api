// src/modules/forms/fields.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Field } from './entities/field.entity';
import { UpdateFieldDto } from './dtos/update-field.dto';
import { CreateFieldDto } from './dtos/create-field.dto';

@Injectable()
export class FieldsService {
  constructor(
    @InjectRepository(Field) private readonly repo: Repository<Field>,
  ) {}

  async create(formId: string, dto: CreateFieldDto) {
    return this.repo.save({ ...dto, form: { id: formId } as any });
  }

  async findOne(id: string) {
    const field = await this.repo.findOne({
      where: { id },
      relations: ['form'],
    });
    if (!field) throw new NotFoundException('Field not found');
    return field;
  }

  async update(id: string, dto: UpdateFieldDto) {
    await this.repo.update(id, dto);
    return this.findOne(id);
  }

  async remove(id: string) {
    await this.repo.delete(id);
  }
}
