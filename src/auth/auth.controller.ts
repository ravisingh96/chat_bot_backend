import { Body, Controller, ForbiddenException, Get, HttpCode, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtService } from '@nestjs/jwt';
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import * as bcrypt from 'bcryptjs';
import { config } from '../config';
import { publicUser, UsersService } from '../users/users.service';
import { AuthGuard } from './auth.guard';

class LoginDto {
  @IsEmail() email: string;
  @IsString() @MaxLength(200) password: string;
}

class RegisterDto {
  @IsString() @MinLength(2) @MaxLength(80) name: string;
  @IsEmail() email: string;
  @IsString() @MinLength(8) @MaxLength(100) password: string;
  @IsOptional() @IsString() @MaxLength(200) code?: string;
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

  /** Self-registration: whoever opens /register can create an admin account (optionally gated by REGISTER_CODE). */
  @Post('register')
  @HttpCode(201)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async register(@Body() dto: RegisterDto) {
    if (config.registerCode && dto.code !== config.registerCode) throw new ForbiddenException('Invalid registration code');
    const user = await this.users.create({ name: dto.name, email: dto.email, password: dto.password, role: 'admin' });
    const token = await this.jwt.signAsync({ sub: user.id });
    return { token, user };
  }

  @Get('me')
  @UseGuards(AuthGuard)
  me(@Req() req: any) {
    return { user: req.user };
  }
}
