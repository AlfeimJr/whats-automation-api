import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UserModule } from './user/user.module';
import { User } from './user/entities/user.entity';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { LoginService } from './login/login.service';
import { LoginModule } from './login/login.module';
import { WhatsAppModule } from './whats/whats.module';
import { ChatModule } from './chat/chat.module';
import * as fs from 'fs';
import * as path from 'path';
import { FormsModule } from './form/form.module';

@Module({
  imports: [
    ConfigModule.forRoot(),
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DATABASE_HOST || 'localhost',
      port: +process.env.DATABASE_PORT || 5432,
      username: process.env.DATABASE_USER || 'postgres',
      password: process.env.DATABASE_PASSWORD || '',
      database: process.env.DATABASE || '',
      entities: [User],
      ssl: {
        ca: fs
          .readFileSync(path.resolve(__dirname, 'ssl', 'us-east-2-bundle.pem'))
          .toString(),
        rejectUnauthorized: true, // exige que o certificado seja confiável
      },
      synchronize: true,
    }),
    AuthModule,
    LoginModule,
    WhatsAppModule,
    ChatModule,
    FormsModule,
    TypeOrmModule.forFeature([User]),
  ],

  controllers: [AppController],
  providers: [AppService, LoginService],
})
export class AppModule {}
