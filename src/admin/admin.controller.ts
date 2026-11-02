import {
  Body, Controller, Delete, Get, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Query, Req, Res, UseGuards,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import type { Response } from 'express';
import { AuthGuard, Roles } from '../auth/auth.guard';
import { Role, UsersService } from '../users/users.service';
import { AdminService } from './admin.service';

class CreateUserDto {
  @IsString() @MinLength(2) @MaxLength(80) name: string;
  @IsEmail() email: string;
  @IsString() @MinLength(8) @MaxLength(100) password: string;
  @IsIn(['admin', 'manager']) role: Role;
}

class UpdateUserDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80) name?: string;
  @IsOptional() @IsIn(['admin', 'manager']) role?: Role;
  @IsOptional() @Type(() => Boolean) @IsBoolean() active?: boolean;
  @IsOptional() @IsString() @MinLength(8) @MaxLength(100) password?: string;
}

/** Admin and manager can read chats/leads and export CSV; only admin can delete data and manage users. */
@Controller('api/admin')
@UseGuards(AuthGuard)
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly users: UsersService,
  ) {}

  @Get('stats')
  stats() {
    return this.admin.stats();
  }

  @Get('chats')
  chats(@Query() q: any) {
    return this.admin.listChats(q);
  }

  @Get('chats/:id')
  chat(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.chat(id);
  }

  @Delete('chats/:id')
  @Roles('admin')
  deleteChat(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.deleteChat(id);
  }

  @Get('leads')
  leads(@Query() q: any) {
    return this.admin.listLeads(q);
  }

  // Declared before any ':id' lead route so "export.csv" is never read as an id.
  @Get('leads/export.csv')
  async exportLeads(@Query() q: any, @Res() res: Response) {
    const csv = await this.admin.exportLeadsCsv(q);
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="leads-${stamp}.csv"`);
    res.send(csv);
  }

  @Delete('leads/:id')
  @Roles('admin')
  deleteLead(@Param('id', ParseIntPipe) id: number) {
    return this.admin.deleteLead(id);
  }

  @Get('users')
  @Roles('admin')
  async listUsers() {
    return { items: await this.users.list() };
  }

  @Post('users')
  @Roles('admin')
  createUser(@Body() dto: CreateUserDto) {
    return this.users.create(dto);
  }

  @Patch('users/:id')
  @Roles('admin')
  updateUser(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateUserDto, @Req() req: any) {
    return this.users.update(id, req.user.id, dto);
  }
}
