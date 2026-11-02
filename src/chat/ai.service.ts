import { Injectable, Logger } from '@nestjs/common';
import { config } from '../config';

export interface ChatMsg {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  get enabled() {
    return !!config.openaiKey;
  }

  /** Returns the model reply, or null when no key is configured or the call fails (caller falls back to scripted text). */
  async complete(messages: ChatMsg[]): Promise<string | null> {
    if (!this.enabled) return null;
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.openaiKey}` },
        body: JSON.stringify({
          model: config.openaiModel,
          messages,
          temperature: 0.5,
          max_tokens: 220,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        this.logger.error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
        return null;
      }
      const data: any = await res.json();
      const text = data?.choices?.[0]?.message?.content;
      return typeof text === 'string' && text.trim() ? text.trim() : null;
    } catch (err) {
      this.logger.error(`OpenAI request failed: ${(err as Error).message}`);
      return null;
    }
  }
}
