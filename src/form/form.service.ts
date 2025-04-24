// src/modules/forms/forms.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Form } from './entities/form.entity';
import { CreateFormDto } from './dtos/create-form.dto';
import { UpdateFormDto } from './dtos/update-form.dto';

@Injectable()
export class FormsService {
  constructor(
    @InjectRepository(Form)
    private readonly repo: Repository<Form>,
  ) {}

  async create(data: CreateFormDto & { userId: string }) {
    const form = this.repo.create(data);
    return this.repo.save(form);
  }

  async findAll(userId: string) {
    return this.repo.find({
      where: { userId },
      relations: ['fields'],
    });
  }

  async findOne(id: string, userId: string) {
    const form = await this.repo.findOne({
      where: { id, userId },
      relations: ['fields'],
    });
    if (!form) throw new NotFoundException('Form not found');
    return form;
  }

  async update(id: string, dto: UpdateFormDto, userId: string) {
    const res = await this.repo.update({ id, userId }, dto);
    if (res.affected === 0)
      throw new NotFoundException('Form not found or not yours');
    return this.findOne(id, userId);
  }

  async remove(id: string, userId: string) {
    const res = await this.repo.delete({ id, userId });
    if (res.affected === 0)
      throw new NotFoundException('Form not found or not yours');
  }
}
