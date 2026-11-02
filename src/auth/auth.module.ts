import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { config } from '../config';
import { UsersService } from '../users/users.service';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';

@Global()
@Module({
  imports: [JwtModule.register({ global: true, secret: config.jwtSecret, signOptions: { expiresIn: '12h' } })],
  controllers: [AuthController],
  providers: [UsersService, AuthGuard],
  exports: [UsersService, AuthGuard],
})
export class AuthModule {}
