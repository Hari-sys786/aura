import type { Agent } from '../core/agent.js';
import type { Logger } from '../core/logger.js';

interface GoogleActionRequest {
  handler: { name: string };
  intent: { name: string; query: string };
  scene: { name: string };
  session: { id: string; params: Record<string, unknown>; languageCode: string };
  user?: { locale: string; verificationStatus: string };
}

interface GoogleActionResponse {
  session?: { id: string; params?: Record<string, unknown> };
  prompt: {
    override: boolean;
    firstSimple?: { speech: string; text?: string };
    content?: { card?: { title: string; subtitle?: string; text: string } };
    suggestions?: Array<{ title: string }>;
  };
  scene?: { name: string; next?: { name: string } };
}

export class GoogleHomeChannel {
  private agent: Agent;
  private log: Logger;

  constructor(agent: Agent, logger: Logger) {
    this.agent = agent;
    this.log = logger;
  }

  async handleRequest(body: string): Promise<GoogleActionResponse> {
    const req = JSON.parse(body) as GoogleActionRequest;
    const handler = req.handler?.name ?? req.intent?.name ?? '';
    const query = req.intent?.query ?? '';

    this.log.info(`Google Home: handler=${handler}, query="${query.slice(0, 100)}"`);

    switch (handler) {
      case 'welcome':
        return this.respond(
          'Hey! I\'m Aura, your personal life manager. Ask me about your schedule, emails, spending, or anything else.',
          ['Schedule', 'Emails', 'Spending', 'Briefing']
        );

      case 'aura_query':
      case 'aura_chat': {
        if (!query) {
          return this.respond('What would you like to know?', ['Schedule', 'Emails', 'Spending']);
        }
        const response = await this.agent.processMessage(query, { channel: 'google-home' });
        return this.respond(response.slice(0, 640)); // Google has tighter limits
      }

      case 'schedule': {
        const response = await this.agent.processMessage('What\'s on my calendar today?', { channel: 'google-home' });
        return this.respond(response.slice(0, 640), undefined, 'Today\'s Schedule');
      }

      case 'emails': {
        const response = await this.agent.processMessage('Show my recent emails', { channel: 'google-home' });
        return this.respond(response.slice(0, 640), undefined, 'Emails');
      }

      case 'spending': {
        const response = await this.agent.processMessage('How much did I spend today?', { channel: 'google-home' });
        return this.respond(response.slice(0, 640), undefined, 'Spending');
      }

      case 'briefing': {
        const response = await this.agent.processMessage('Give me my morning briefing', { channel: 'google-home' });
        return this.respond(response.slice(0, 640), undefined, 'Briefing');
      }

      case 'goodbye':
        return this.respond('See you later!');

      default: {
        if (query) {
          const response = await this.agent.processMessage(query, { channel: 'google-home' });
          return this.respond(response.slice(0, 640));
        }
        return this.respond('Try asking about your schedule, emails, or spending.');
      }
    }
  }

  private respond(speech: string, suggestions?: string[], cardTitle?: string): GoogleActionResponse {
    const response: GoogleActionResponse = {
      prompt: {
        override: false,
        firstSimple: { speech, text: speech },
      },
    };

    if (suggestions) {
      response.prompt.suggestions = suggestions.map(s => ({ title: s }));
    }

    if (cardTitle) {
      response.prompt.content = {
        card: { title: cardTitle, text: speech },
      };
    }

    return response;
  }
}
