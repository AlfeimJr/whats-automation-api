import { ApiProperty } from '@nestjs/swagger';

export class CreateUserDto {
  id: string;
  @ApiProperty()
  name: string;

  @ApiProperty()
  email: string;

  @ApiProperty()
  password: string;

  @ApiProperty()
  role: number;
}
