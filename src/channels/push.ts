import type { Logger } from '../core/logger.js';

interface PushConfig {
  fcmServerKey?: string;      // Firebase Cloud Messaging
  apnsKeyId?: string;         // Apple Push Notification Service
  apnsTeamId?: string;
  apnsPrivateKey?: string;
  apnsBundleId?: string;
  apnsProduction?: boolean;
}

interface PushTarget {
  platform: 'android' | 'ios' | 'web';
  token: string;
  deviceName?: string;
}

interface PushNotification {
  title: string;
  body: string;
  category?: string;
  urgency?: 'low' | 'normal' | 'high' | 'critical';
  data?: Record<string, string>;
  badge?: number;
  sound?: string;
}

export class PushChannel {
  private config: PushConfig;
  private log: Logger;
  private devices: Map<string, PushTarget> = new Map();

  constructor(config: PushConfig, logger: Logger) {
    this.config = config;
    this.log = logger;
  }

  // --- Device Registration ---

  registerDevice(userId: string, device: PushTarget): void {
    this.devices.set(`${userId}:${device.platform}`, device);
    this.log.info(`Push device registered: ${device.deviceName ?? device.platform} for ${userId}`);
  }

  unregisterDevice(userId: string, platform: string): void {
    this.devices.delete(`${userId}:${platform}`);
  }

  getDevices(userId?: string): PushTarget[] {
    if (!userId) return Array.from(this.devices.values());
    return Array.from(this.devices.entries())
      .filter(([key]) => key.startsWith(`${userId}:`))
      .map(([, device]) => device);
  }

  // --- Send Notifications ---

  async sendToUser(userId: string, notification: PushNotification): Promise<void> {
    const devices = this.getDevices(userId);
    if (devices.length === 0) {
      this.log.debug(`No push devices for user ${userId}`);
      return;
    }

    for (const device of devices) {
      try {
        if (device.platform === 'android' || device.platform === 'web') {
          await this.sendFCM(device.token, notification);
        } else if (device.platform === 'ios') {
          await this.sendAPNS(device.token, notification);
        }
      } catch (err) {
        this.log.error(`Push failed for ${device.deviceName ?? device.platform}: ${err}`);
      }
    }
  }

  async sendToAll(notification: PushNotification): Promise<void> {
    const uniqueTokens = new Set<string>();

    for (const device of this.devices.values()) {
      if (uniqueTokens.has(device.token)) continue;
      uniqueTokens.add(device.token);

      try {
        if (device.platform === 'android' || device.platform === 'web') {
          await this.sendFCM(device.token, notification);
        } else if (device.platform === 'ios') {
          await this.sendAPNS(device.token, notification);
        }
      } catch (err) {
        this.log.error(`Push broadcast failed: ${err}`);
      }
    }
  }

  // --- Firebase Cloud Messaging (Android + Web + Wear OS) ---

  private async sendFCM(token: string, notification: PushNotification): Promise<void> {
    if (!this.config.fcmServerKey) {
      this.log.warn('FCM not configured — set fcmServerKey');
      return;
    }

    const priority = notification.urgency === 'critical' || notification.urgency === 'high' ? 'high' : 'normal';

    const payload = {
      to: token,
      priority,
      notification: {
        title: notification.title,
        body: notification.body,
        sound: notification.sound ?? 'default',
        badge: notification.badge,
        tag: notification.category,
      },
      data: {
        ...notification.data,
        category: notification.category ?? 'general',
        urgency: notification.urgency ?? 'normal',
        timestamp: new Date().toISOString(),
      },
    };

    const res = await fetch('https://fcm.googleapis.com/fcm/send', {
      method: 'POST',
      headers: {
        'Authorization': `key=${this.config.fcmServerKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      throw new Error(`FCM error (${res.status}): ${await res.text()}`);
    }

    const data = await res.json() as { success: number; failure: number };
    if (data.failure > 0) {
      this.log.warn(`FCM partial failure: ${data.failure} failed`);
    }
  }

  // --- Apple Push Notification Service (iOS + Apple Watch) ---

  private async sendAPNS(token: string, notification: PushNotification): Promise<void> {
    if (!this.config.apnsKeyId || !this.config.apnsTeamId) {
      this.log.warn('APNS not configured — set apnsKeyId + apnsTeamId');
      return;
    }

    const host = this.config.apnsProduction
      ? 'https://api.push.apple.com'
      : 'https://api.sandbox.push.apple.com';

    const priority = notification.urgency === 'critical' ? '10' : '5';

    const payload = {
      aps: {
        alert: {
          title: notification.title,
          body: notification.body,
        },
        badge: notification.badge,
        sound: notification.sound ?? 'default',
        category: notification.category,
        'thread-id': notification.category ?? 'aura',
        'interruption-level': notification.urgency === 'critical' ? 'critical' :
                              notification.urgency === 'high' ? 'time-sensitive' :
                              notification.urgency === 'low' ? 'passive' : 'active',
      },
      data: notification.data,
    };

    const res = await fetch(`${host}/3/device/${token}`, {
      method: 'POST',
      headers: {
        'apns-topic': this.config.apnsBundleId ?? '',
        'apns-priority': priority,
        'apns-push-type': 'alert',
        'Content-Type': 'application/json',
        // In production, use JWT auth. This is simplified.
        'Authorization': `bearer ${this.generateAPNSToken()}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      throw new Error(`APNS error (${res.status}): ${await res.text()}`);
    }
  }

  private generateAPNSToken(): string {
    // In production, generate JWT with ES256 using apnsKeyId, apnsTeamId, apnsPrivateKey
    // For now return placeholder — real implementation needs jsonwebtoken or jose
    this.log.warn('APNS JWT generation not implemented — use real JWT library in production');
    return 'placeholder-token';
  }

  // --- Notification Helpers ---

  async sendBriefing(userId: string, type: 'morning' | 'evening' | 'weekly', summary: string): Promise<void> {
    const titles: Record<string, string> = {
      morning: '🌅 Morning Briefing',
      evening: '🌙 Evening Summary',
      weekly: '📊 Weekly Overview',
    };

    await this.sendToUser(userId, {
      title: titles[type] ?? 'Aura Briefing',
      body: summary.slice(0, 200),
      category: 'briefing',
      urgency: 'normal',
      data: { type, fullText: summary.slice(0, 1000) },
    });
  }

  async sendAlert(userId: string, title: string, body: string, urgency: PushNotification['urgency'] = 'high'): Promise<void> {
    await this.sendToUser(userId, { title, body, urgency, category: 'alert' });
  }

  async sendBillReminder(userId: string, vendor: string, amount: number, dueDate: string): Promise<void> {
    await this.sendToUser(userId, {
      title: `💰 Bill Due: ${vendor}`,
      body: `₹${amount} due on ${dueDate}`,
      category: 'finance',
      urgency: 'high',
      data: { vendor, amount: String(amount), dueDate },
    });
  }

  async sendSubscriptionRenewal(userId: string, name: string, amount: number, date: string): Promise<void> {
    await this.sendToUser(userId, {
      title: `🔔 Renewal: ${name}`,
      body: `₹${amount} renewing on ${date}`,
      category: 'subscription',
      urgency: 'normal',
    });
  }

  async sendDocumentExpiry(userId: string, docName: string, daysLeft: number): Promise<void> {
    await this.sendToUser(userId, {
      title: `📄 Document Expiring`,
      body: `${docName} expires in ${daysLeft} days`,
      category: 'document',
      urgency: daysLeft <= 7 ? 'high' : 'normal',
    });
  }
}
