// src/modules/forms/fields.controller.ts
import { Body, Controller, Delete, Param, Patch, Post } from '@nestjs/common';
import { CreateFieldDto } from './dtos/create-field.dto';
import { FieldsService } from './fied.service';
import { UpdateFieldDto } from './dtos/update-field.dto';

@Controller('fields')
export class FieldsController {
  constructor(private readonly service: FieldsService) {}

  // cria campo dentro de um form específico
  @Post(':formId')
  create(@Param('formId') formId: string, @Body() dto: CreateFieldDto) {
    return this.service.create(formId, dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateFieldDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
