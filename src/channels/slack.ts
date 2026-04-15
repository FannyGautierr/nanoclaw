import { App } from '@slack/bolt';

import { readEnvFile } from '../env.js';
import { logger } from '../logger.js';
import {
  Channel,
  NewMessage,
  OnChatMetadata,
  OnInboundMessage,
  RegisteredGroup,
} from '../types.js';
import { ChannelOpts, registerChannel } from './registry.js';

const SLACK_PREFIX = 'slack:';

class SlackChannel implements Channel {
  name = 'slack';
  private app: App;
  private connected = false;
  private onMessage: OnInboundMessage;
  private onChatMetadata: OnChatMetadata;
  private registeredGroups: () => Record<string, RegisteredGroup>;
  private botUserId: string | undefined;

  constructor(botToken: string, appToken: string, opts: ChannelOpts) {
    this.onMessage = opts.onMessage;
    this.onChatMetadata = opts.onChatMetadata;
    this.registeredGroups = opts.registeredGroups;

    this.app = new App({
      token: botToken,
      appToken,
      socketMode: true,
    });
  }

  async connect(): Promise<void> {
    // Resolve bot's own user ID to mark outgoing messages correctly
    try {
      const auth = await this.app.client.auth.test();
      this.botUserId = auth.user_id as string | undefined;
    } catch (err) {
      logger.warn({ err }, 'Slack: could not resolve bot user ID');
    }

    this.app.message(async ({ message }) => {
      const channelId = (message as any).channel as string | undefined;
      if (!channelId) return;

      const jid = `${SLACK_PREFIX}${channelId}`;
      if (!this.registeredGroups()[jid]) return;

      const text: string = (message as any).text ?? '';
      if (!text) return;

      const ts: string = (message as any).ts ?? String(Date.now() / 1000);
      const timestamp = new Date(parseFloat(ts) * 1000).toISOString();
      const userId: string =
        (message as any).user ?? (message as any).bot_id ?? 'unknown';
      const isBot = !!(message as any).bot_id;
      const isFromMe = isBot && userId === this.botUserId;

      const newMsg: NewMessage = {
        id: `slack_${ts.replace('.', '_')}`,
        chat_jid: jid,
        sender: userId,
        sender_name: userId,
        content: text,
        timestamp,
        is_from_me: isFromMe,
        is_bot_message: isBot,
      };

      this.onChatMetadata(jid, timestamp, undefined, 'slack', true);
      this.onMessage(jid, newMsg);
    });

    await this.app.start();
    this.connected = true;
    logger.info('Slack channel connected');
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    const channelId = jid.slice(SLACK_PREFIX.length);
    const chunks: string[] = [];
    let remaining = text;
    while (remaining.length > 4000) {
      chunks.push(remaining.slice(0, 4000));
      remaining = remaining.slice(4000);
    }
    if (remaining) chunks.push(remaining);

    for (const chunk of chunks) {
      await this.app.client.chat.postMessage({
        channel: channelId,
        text: chunk,
      });
    }
  }

  async sendFile(
    jid: string,
    filePath: string,
    caption?: string,
  ): Promise<void> {
    const channelId = jid.slice(SLACK_PREFIX.length);
    await this.app.client.files.uploadV2({
      channel_id: channelId,
      file: filePath,
      initial_comment: caption,
    });
  }

  isConnected(): boolean {
    return this.connected;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith(SLACK_PREFIX);
  }

  async disconnect(): Promise<void> {
    await this.app.stop();
    this.connected = false;
    logger.info('Slack channel disconnected');
  }

  async syncGroups(force: boolean): Promise<void> {
    try {
      const result = await this.app.client.conversations.list({ limit: 200 });
      if (!result.channels) return;
      const timestamp = new Date().toISOString();
      for (const ch of result.channels) {
        if (!ch.id || !ch.name) continue;
        const jid = `${SLACK_PREFIX}${ch.id}`;
        this.onChatMetadata(jid, timestamp, ch.name, 'slack', true);
      }
    } catch (err) {
      logger.warn({ err }, 'Slack: failed to sync channel metadata');
    }
  }
}

registerChannel('slack', (opts: ChannelOpts): Channel | null => {
  const secrets = readEnvFile(['SLACK_BOT_TOKEN', 'SLACK_APP_TOKEN']);
  const botToken = process.env.SLACK_BOT_TOKEN || secrets.SLACK_BOT_TOKEN;
  const appToken = process.env.SLACK_APP_TOKEN || secrets.SLACK_APP_TOKEN;
  if (!botToken || !appToken) return null;
  return new SlackChannel(botToken, appToken, opts);
});
