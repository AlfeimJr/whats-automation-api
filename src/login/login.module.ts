import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { LoginController } from './login.controller';
import { LoginService } from './login.service';
import { User } from '../user/entities/user.entity';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([User]), forwardRef(() => AuthModule)],
  controllers: [LoginController],
  exports: [LoginService],
  providers: [LoginService],
})
export class LoginModule {}
