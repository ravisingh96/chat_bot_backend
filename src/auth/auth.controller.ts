import { Body, Controller, Get, HttpCode, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtService } from '@nestjs/jwt';
import { IsEmail, IsString, MaxLength } from 'class-validator';
import * as bcrypt from 'bcryptjs';
import { publicUser, UsersService } from '../users/users.service';
import { AuthGuard } from './auth.guard';

class LoginDto {
  @IsEmail() email: string;
  @IsString() @MaxLength(200) password: string;
}

// Compared against when the email is unknown so response time does not reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

@Controller('api/auth')
export class AuthController {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
  ) {}

  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async login(@Body() dto: LoginDto) {
    const user = await this.users.findByEmail(dto.email);
    const ok = await bcrypt.compare(dto.password, user?.password_hash ?? DUMMY_HASH);
    if (!user || !ok || !user.active) throw new UnauthorizedException('Invalid email or password');
    const token = await this.jwt.signAsync({ sub: user.id });
    return { token, user: publicUser(user) };
  }

  @Get('me')
  @UseGuards(AuthGuard)
  me(@Req() req: any) {
    return { user: req.user };
  }
}
