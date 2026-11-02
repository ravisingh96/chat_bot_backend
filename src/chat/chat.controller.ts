import { Body, Controller, Get, Headers, HttpCode, Ip, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { ChatService } from './chat.service';

class StartDto {
  @IsOptional() @IsString() @MaxLength(300) pageUrl?: string;
}

class MessageDto {
  @IsUUID() sessionId: string;
  @IsString() @MaxLength(4000) message: string;
}

@Controller('api/chat')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Post('start')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  start(@Body() dto: StartDto, @Ip() ip: string, @Headers('user-agent') ua?: string) {
    return this.chat.start({ ip, userAgent: ua, pageUrl: dto.pageUrl });
  }

  @Post('message')
  @HttpCode(200)
  @Throttle({ default: { limit: 25, ttl: 60_000 } })
  message(@Body() dto: MessageDto) {
    return this.chat.message(dto.sessionId, dto.message);
  }

  @Get(':id')
  history(@Param('id', ParseUUIDPipe) id: string) {
    return this.chat.history(id);
  }
}
