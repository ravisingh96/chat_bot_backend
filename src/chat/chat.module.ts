import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

@Module({
  controllers: [ChatController],
  providers: [ChatService, AiService],
})
export class ChatModule {}
