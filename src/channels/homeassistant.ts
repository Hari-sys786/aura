import type { Agent } from '../core/agent.js';
import type { MemoryStore } from '../core/storage/index.js';
import type { PluginBus } from '../core/plugin-bus.js';
import type { Logger } from '../core/logger.js';

interface HAConfig {
  url: string;          // Home Assistant URL (e.g., http://192.168.1.100:8123)
  token: string;        // Long-lived access token
  mqttBroker?: string;  // MQTT broker URL (e.g., mqtt://192.168.1.100:1883)
  mqttUser?: string;
  mqttPass?: string;
  pollIntervalMs?: number;
}

interface HAState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed: string;
  last_updated: string;
}

interface HAService {
  domain: string;
  service: string;
  data?: Record<string, unknown>;
  target?: { entity_id: string | string[] };
}

export class HomeAssistantChannel {
  private agent: Agent;
  private storage: MemoryStore;
  private plugins: PluginBus;
  private log: Logger;
  private config: HAConfig;
  private connected = false;

  constructor(config: HAConfig, agent: Agent, storage: MemoryStore, plugins: PluginBus, logger: Logger) {
    this.config = config;
    this.agent = agent;
    this.storage = storage;
    this.plugins = plugins;
    this.log = logger;
  }

  async connect(): Promise<void> {
    try {
      // Verify connection
      const res = await fetch(`${this.config.url}/api/`, {
        headers: { Authorization: `Bearer ${this.config.token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { message: string };
      this.connected = true;
      this.log.info(`Home Assistant connected: ${data.message}`);

      // Initial state sync
      await this.syncStates();

      // Start polling for state changes
      if (this.config.pollIntervalMs) {
        setInterval(() => this.syncStates(), this.config.pollIntervalMs);
      }
    } catch (err) {
      this.log.error(`Home Assistant connection failed: ${err}`);
    }
  }

  // --- State Management ---

  async getStates(): Promise<HAState[]> {
    const res = await fetch(`${this.config.url}/api/states`, {
      headers: { Authorization: `Bearer ${this.config.token}` },
    });
    if (!res.ok) throw new Error(`Failed to get states: ${res.status}`);
    return await res.json() as HAState[];
  }

  async getState(entityId: string): Promise<HAState | null> {
    try {
      const res = await fetch(`${this.config.url}/api/states/${entityId}`, {
        headers: { Authorization: `Bearer ${this.config.token}` },
      });
      if (!res.ok) return null;
      return await res.json() as HAState;
    } catch {
      return null;
    }
  }

  async syncStates(): Promise<void> {
    try {
      const states = await this.getStates();
      const important = states.filter(s =>
        s.entity_id.startsWith('light.') ||
        s.entity_id.startsWith('switch.') ||
        s.entity_id.startsWith('sensor.') ||
        s.entity_id.startsWith('climate.') ||
        s.entity_id.startsWith('lock.') ||
        s.entity_id.startsWith('cover.') ||
        s.entity_id.startsWith('media_player.') ||
        s.entity_id.startsWith('alarm_control_panel.')
      );

      for (const state of important) {
        this.storage.set('ha-states', state.entity_id, {
          entity_id: state.entity_id,
          state: state.state,
          attributes: state.attributes,
          last_changed: state.last_changed,
        });
      }

      this.log.debug(`HA synced: ${important.length} entities`);
      this.plugins.emit('ha:synced', { count: important.length });
    } catch (err) {
      this.log.error(`HA sync failed: ${err}`);
    }
  }

  // --- Service Calls ---

  async callService(service: HAService): Promise<unknown> {
    const res = await fetch(`${this.config.url}/api/services/${service.domain}/${service.service}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...service.data,
        ...(service.target ? { entity_id: service.target.entity_id } : {}),
      }),
    });

    if (!res.ok) throw new Error(`Service call failed: ${res.status}`);
    this.log.info(`HA service: ${service.domain}.${service.service}`);
    this.storage.audit('ha:service', { service: `${service.domain}.${service.service}`, target: service.target });
    return await res.json();
  }

  // --- Convenience Methods ---

  async turnOn(entityId: string): Promise<void> {
    const domain = entityId.split('.')[0];
    await this.callService({ domain, service: 'turn_on', target: { entity_id: entityId } });
  }

  async turnOff(entityId: string): Promise<void> {
    const domain = entityId.split('.')[0];
    await this.callService({ domain, service: 'turn_off', target: { entity_id: entityId } });
  }

  async toggle(entityId: string): Promise<void> {
    const domain = entityId.split('.')[0];
    await this.callService({ domain, service: 'toggle', target: { entity_id: entityId } });
  }

  async setTemperature(entityId: string, temp: number): Promise<void> {
    await this.callService({
      domain: 'climate',
      service: 'set_temperature',
      target: { entity_id: entityId },
      data: { temperature: temp },
    });
  }

  async lock(entityId: string): Promise<void> {
    await this.callService({ domain: 'lock', service: 'lock', target: { entity_id: entityId } });
  }

  async unlock(entityId: string): Promise<void> {
    await this.callService({ domain: 'lock', service: 'unlock', target: { entity_id: entityId } });
  }

  // --- Scene Activation ---

  async activateScene(sceneId: string): Promise<void> {
    await this.callService({ domain: 'scene', service: 'turn_on', target: { entity_id: sceneId } });
  }

  // --- Query for AI ---

  getDeviceSummary(): string {
    const states = this.storage.sqlite.list('ha-states');
    if (states.length === 0) return 'No Home Assistant devices connected.';

    const byDomain = new Map<string, Array<{ name: string; state: string }>>();

    for (const row of states) {
      const s = JSON.parse(row.value);
      const domain = s.entity_id.split('.')[0];
      const name = (s.attributes?.friendly_name as string) ?? s.entity_id;
      const list = byDomain.get(domain) ?? [];
      list.push({ name, state: s.state });
      byDomain.set(domain, list);
    }

    const sections: string[] = ['🏠 <b>Smart Home</b>\n'];

    const domainEmoji: Record<string, string> = {
      light: '💡', switch: '🔌', sensor: '📊', climate: '🌡️',
      lock: '🔒', cover: '🪟', media_player: '🎵', alarm_control_panel: '🚨',
    };

    for (const [domain, devices] of byDomain) {
      const emoji = domainEmoji[domain] ?? '📦';
      sections.push(`${emoji} <b>${domain}</b>`);
      for (const d of devices) {
        const icon = d.state === 'on' ? '🟢' : d.state === 'off' ? '🔴' : '⚪';
        sections.push(`  ${icon} ${d.name}: ${d.state}`);
      }
    }

    return sections.join('\n');
  }

  isConnected(): boolean {
    return this.connected;
  }
}
