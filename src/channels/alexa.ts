import http from 'http';
import type { Agent } from '../core/agent.js';
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

export class AlexaChannel {
  private agent: Agent;
  private log: Logger;
  private skillId: string;

  constructor(agent: Agent, logger: Logger, skillId?: string) {
    this.agent = agent;
    this.log = logger;
    this.skillId = skillId ?? '';
  }

  async handleRequest(body: string): Promise<AlexaResponse> {
    const req = JSON.parse(body) as AlexaRequest;

    // Verify skill ID if configured
    if (this.skillId && req.session.application.applicationId !== this.skillId) {
      this.log.warn(`Alexa: invalid skill ID ${req.session.application.applicationId}`);
      return this.respond('Unauthorized.', true);
    }

    switch (req.request.type) {
      case 'LaunchRequest':
        return this.respond(
          'Welcome to Aura, your personal life manager. You can ask me about your schedule, emails, spending, or anything else. What would you like to know?',
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

  private async handleIntent(intent: string, slots?: Record<string, { value?: string }>): Promise<AlexaResponse> {
    this.log.info(`Alexa intent: ${intent}`);

    switch (intent) {
      case 'AuraQueryIntent':
      case 'AuraChatIntent': {
        const query = slots?.query?.value ?? slots?.message?.value ?? '';
        if (!query) {
          return this.respond('What would you like to know?', false, undefined, undefined, true);
        }
        const response = await this.agent.processMessage(query, { channel: 'alexa' });
        // Truncate for speech (Alexa has 8000 char limit for SSML)
        const speech = response.slice(0, 1000);
        return this.respond(speech, false, 'Aura', response.slice(0, 500));
      }

      case 'ScheduleIntent': {
        const response = await this.agent.processMessage('What\'s on my calendar today?', { channel: 'alexa' });
        return this.respond(response.slice(0, 1000), false, 'Today\'s Schedule');
      }

      case 'EmailIntent': {
        const response = await this.agent.processMessage('Show my recent emails', { channel: 'alexa' });
        return this.respond(response.slice(0, 1000), false, 'Emails');
      }

      case 'SpendingIntent': {
        const response = await this.agent.processMessage('How much did I spend today?', { channel: 'alexa' });
        return this.respond(response.slice(0, 1000), false, 'Spending');
      }

      case 'BriefingIntent': {
        const response = await this.agent.processMessage('Give me my morning briefing', { channel: 'alexa' });
        return this.respond(response.slice(0, 1000), false, 'Briefing');
      }

      case 'AMAZON.HelpIntent':
        return this.respond(
          'I can help with your schedule, emails, spending, and more. Try saying: What\'s on my calendar? Or: How much did I spend today?',
          false
        );

      case 'AMAZON.StopIntent':
      case 'AMAZON.CancelIntent':
        return this.respond('Goodbye!', true);

      case 'AMAZON.FallbackIntent':
        return this.respond('I\'m not sure about that. Try asking about your schedule, emails, or spending.', false);

      default: {
        // Try processing as general query
        const response = await this.agent.processMessage(intent, { channel: 'alexa' });
        return this.respond(response.slice(0, 1000), false);
      }
    }
  }

  private respond(text: string, endSession: boolean, cardTitle?: string, cardContent?: string, reprompt?: boolean): AlexaResponse {
    const response: AlexaResponse = {
      version: '1.0',
      response: {
        outputSpeech: text ? { type: 'PlainText', text } : undefined,
        shouldEndSession: endSession,
      },
    };

    if (cardTitle) {
      response.response.card = {
        type: 'Simple',
        title: cardTitle,
        content: cardContent ?? text,
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
