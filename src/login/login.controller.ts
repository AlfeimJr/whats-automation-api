import { Controller, Post, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthLoginDto } from '../user/dto/auth-login.dto';
import { AuthService } from '../auth/auth.service';

@ApiTags('Login')
@Controller('auth')
export class LoginController {
  constructor(private authService: AuthService) {}

  @ApiOperation({ summary: 'Login' })
  @ApiBody({ type: AuthLoginDto })
  @Post('login')
  @UseGuards(AuthGuard('local'))
  async login(@Request() req) {
    return this.authService.login(req.user);
  }
}
