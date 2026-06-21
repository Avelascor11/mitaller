import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { SpeedwearAiQuestionDto, SpeedwearAiService } from './speedwear-ai.service';

@Controller('speedwear-ai')
export class SpeedwearAiController {
  constructor(private readonly ai: SpeedwearAiService) {}

  @Post('chat')
  ask(@Body() body: SpeedwearAiQuestionDto) {
    return this.ai.ask(body);
  }

  @Get('chat')
  chat(@Query('limit') limit?: string) {
    return this.ai.chat(Number(limit ?? 30));
  }

  @Get('context')
  context() {
    return this.ai.contextSnapshot();
  }
}
