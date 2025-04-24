// src/modules/forms/forms.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Form } from './entities/form.entity';
import { FormsController } from './form.controller';
import { FieldsController } from 'src/field/field.controller';
import { Field } from 'src/field/entities/field.entity';
import { FieldsService } from 'src/field/fied.service';
import { FormsService } from './form.service';

@Module({
  imports: [TypeOrmModule.forFeature([Form, Field])],
  controllers: [FormsController, FieldsController],
  providers: [FormsService, FieldsService],
  exports: [FormsService, FieldsService],
})
export class FormsModule {}
