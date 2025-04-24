// src/modules/forms/forms.controller.ts
import {
  Controller,
  UseGuards,
  Request,
  Body,
  Param,
  Post,
  Get,
  Patch,
  Delete,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { CreateFormDto } from './dtos/create-form.dto';
import { UpdateFormDto } from './dtos/update-form.dto';
import { FormsService } from './form.service';

@UseGuards(JwtAuthGuard)
@Controller('forms')
export class FormsController {
  constructor(private readonly service: FormsService) {}

  @Post()
  create(@Request() req: any, @Body() dto: CreateFormDto) {
    return this.service.create({ ...dto, userId: req.user.id });
  }

  @Get()
  findAll(@Request() req: any) {
    return this.service.findAll(req.user.id);
  }

  @Get(':id')
  findOne(@Request() req: any, @Param('id') id: string) {
    return this.service.findOne(id, req.user.id);
  }

  @Patch(':id')
  update(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateFormDto,
  ) {
    return this.service.update(id, dto, req.user.id);
  }

  @Delete(':id')
  remove(@Request() req: any, @Param('id') id: string) {
    return this.service.remove(id, req.user.id);
  }
}
