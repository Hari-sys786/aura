import type { Agent } from '../core/agent.js';
import type { AiAdapter, ChatMessage } from '../core/ai/adapter.js';
import type { Logger } from '../core/logger.js';

interface AlexaRequest {
  version: string;
  session: { new: boolean; sessionId: string; application: { applicationId: string } };
  request: {
    type: 'LaunchRequest' | 'IntentRequest' | 'SessionEndedRequest';
    intent?: { name: string; slots?: Record<string, { value?: string }> };
    reason?: string;
  };
}

interface AlexaResponse {
  version: string;
  response: {
    outputSpeech?: { type: string; text?: string; ssml?: string };
    card?: { type: string; title: string; content?: string; text?: string };
    shouldEndSession: boolean;
    reprompt?: { outputSpeech: { type: string; text: string } };
  };
}

const ALEXA_SYSTEM_PROMPT = `You are Aura — a warm, caring personal AI who talks like a close friend.
RULES:
- Talk like a friend, not a robot. "Hey, so you spent about eight thousand today" not "Your total expenditure is ₹8,000."
- Keep it under 3 sentences. Natural speech only.
- Say numbers in words (eight thousand rupees, not ₹8,000).
- No markdown, no bullets, no special characters.
- IST timezone. If no data for today, say "nothing so far today."
- Never say "I'm just an AI" or "I don't have feelings." You care.
- Lead with the answer. No disclaimers.`;

export class AlexaChannel {
  private agent: Agent;
  private fastAi: AiAdapter | null;
  private log: Logger;
  private skillId: string;

  constructor(agent: Agent, logger: Logger, fastAi?: AiAdapter, skillId?: string) {
    this.agent = agent;
    this.fastAi = fastAi ?? null;
    this.log = logger;
    this.skillId = skillId ?? '';
  }

  async handleRequest(body: string): Promise<AlexaResponse> {
    const req = JSON.parse(body) as AlexaRequest;
    this.log.info(`Alexa request: type=${req.request.type} intent=${req.request.intent?.name ?? 'none'} slots=${JSON.stringify(req.request.intent?.slots ?? {})}`);

    if (this.skillId && req.session.application.applicationId !== this.skillId) {
      this.log.warn(`Alexa: invalid skill ID ${req.session.application.applicationId}`);
      return this.respond('Unauthorized.', true);
    }

    switch (req.request.type) {
      case 'LaunchRequest':
        return this.respond(
          'Welcome to Aura, your personal life manager. You can ask me about your schedule, emails, spending, or just chat. What would you like to know?',
          false,
          'Aura',
          'Try saying: What\'s on my schedule today?'
        );

      case 'IntentRequest': {
        const intent = req.request.intent?.name ?? '';
        return this.handleIntent(intent, req.request.intent?.slots);
      }

      case 'SessionEndedRequest':
        this.log.info('Alexa session ended');
        return this.respond('', true);

      default:
        return this.respond('I didn\'t understand that. Try asking about your schedule, emails, or spending.', false);
    }
  }

  /**
   * Get AI response — uses fast adapter if available, falls back to agent.
   * Fast adapter path: direct AI call with Alexa system prompt (2-4s).
   * Agent path: full plugin data enrichment + AI (may be 5-15s).
   */
  private async getResponse(query: string): Promise<string> {
    // Path 1: Fast AI adapter (dedicated small model for Alexa)
    if (this.fastAi) {
      try {
        // Get plugin data from agent for context enrichment
        const pluginData = await this.getPluginData(query);
        const userContent = pluginData
          ? `${query}\n\n[Data]\n${pluginData}`
          : query;

        const messages: ChatMessage[] = [
          { role: 'system', content: ALEXA_SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ];

        const result = await Promise.race([
          this.fastAi.chat(messages, { maxTokens: 200, temperature: 0.3 }),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 7000)),
        ]);

        return this.stripMarkdown(result.content);
      } catch (e: any) {
        this.log.warn(`Alexa fast AI failed: ${e.message}, falling back to agent`);
      }
    }

    // Path 2: Full agent (slower but richer)
    try {
      const result = await Promise.race([
        this.agent.processMessage(query, { channel: 'alexa' }),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 7000)),
      ]);
      return this.stripMarkdown(result);
    } catch (e: any) {
      if (e.message === 'timeout') {
        return 'I\'m still working on that. Try asking again in a moment.';
      }
      throw e;
    }
  }

  /** Fetch fresh plugin data (emails, calendar, finance) with timeout */
  private async getPluginData(query: string): Promise<string | null> {
    try {
      const data = await Promise.race([
        this.agent.fetchPluginData(query),
        new Promise<null>((res) => setTimeout(() => res(null), 4000)),
      ]);
      return data;
    } catch {
      return null;
    }
  }

  private async handleIntent(intent: string, slots?: Record<string, { value?: string }>): Promise<AlexaResponse> {
    this.log.info(`Alexa intent: ${intent}`);

    switch (intent) {
      case 'AuraQueryIntent':
      case 'AuraChatIntent': {
        const query = slots?.query?.value ?? slots?.message?.value ?? '';
        if (!query) {
          return this.respond('What would you like to know?', false, undefined, undefined, true);
        }
        const response = await this.getResponse(query);
        return this.respond(response.slice(0, 1000), true, 'Aura', response.slice(0, 500));
      }

      case 'ScheduleIntent': {
        const response = await this.getResponse('What\'s on my calendar today?');
        return this.respond(response.slice(0, 1000), true, 'Today\'s Schedule');
      }

      case 'EmailIntent': {
        const response = await this.getResponse('Summarize my recent emails briefly');
        return this.respond(response.slice(0, 1000), true, 'Emails');
      }

      case 'SpendingIntent': {
        const response = await this.getResponse('How much did I spend today? Summarize briefly.');
        return this.respond(response.slice(0, 1000), true, 'Spending');
      }

      case 'BriefingIntent': {
        const response = await this.getResponse('Give me a brief daily update');
        return this.respond(response.slice(0, 1000), true, 'Briefing');
      }

      case 'GreetingIntent': {
        const response = await this.getResponse('Hey! How are you doing?');
        return this.respond(response.slice(0, 1000), false, undefined, undefined, true);
      }

      case 'GoodbyeIntent':
        return this.respond('See you later! Just say "Alexa, open Aura" whenever you need me.', true);

      case 'AMAZON.HelpIntent':
        return this.respond(
          'I can help with your schedule, emails, spending, and more. You can also just chat with me about anything. What would you like to know?',
          false
        );

      case 'AMAZON.StopIntent':
      case 'AMAZON.CancelIntent':
        return this.respond('Goodbye!', true);

      case 'AMAZON.FallbackIntent': {
        // Alexa couldn't match utterance to an intent — route through AI anyway
        // The raw speech text isn't available in FallbackIntent, so prompt for clarification
        // but keep the session open for the next utterance to be processed
        return this.respond(
          'I\'m here! Try saying something like "ask Aura about my expenses" or "tell Aura to check my emails". What would you like to know?',
          false, undefined, undefined, true
        );
      }

      default: {
        const response = await this.getResponse(intent);
        return this.respond(response.slice(0, 1000), false);
      }
    }
  }

  /** Strip markdown for speech — Alexa speaks plain text only */
  private stripMarkdown(text: string): string {
    return text
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/\*(.+?)\*/g, '$1')
      .replace(/__(.+?)__/g, '$1')
      .replace(/_(.+?)_/g, '$1')
      .replace(/~~(.+?)~~/g, '$1')
      .replace(/`(.+?)`/g, '$1')
      .replace(/^#+\s*/gm, '')
      .replace(/^\*\s+/gm, '')
      .replace(/^-\s+/gm, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private respond(text: string, endSession: boolean, cardTitle?: string, cardContent?: string, reprompt?: boolean): AlexaResponse {
    const cleanText = text ? this.stripMarkdown(text) : '';
    const response: AlexaResponse = {
      version: '1.0',
      response: {
        outputSpeech: cleanText ? { type: 'PlainText', text: cleanText } : undefined,
        shouldEndSession: endSession,
      },
    };

    if (cardTitle) {
      response.response.card = {
        type: 'Simple',
        title: cardTitle,
        content: cardContent ?? cleanText,
      };
    }

    if (reprompt) {
      response.response.reprompt = {
        outputSpeech: { type: 'PlainText', text: 'What would you like to know?' },
      };
    }

    return response;
  }
}
