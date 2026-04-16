/**
 * Unipile channel — LinkedIn DMs + Email via Unipile REST API.
 *
 * Required env vars (add to .env on the deployment machine):
 *   UNIPILE_API_KEY=<your-api-key>
 *   UNIPILE_DSN=<your-dsn>          # e.g. api4.unipile.com:13450
 *
 * JID namespacing:
 *   unipile-li:<chat_id>            LinkedIn DMs
 *   unipile-email:<email_id>        Emails
 *
 * The channel polls every POLL_INTERVAL_MS (default 60 s) for new items.
 * Messages already seen are tracked in processedIds to avoid duplicates.
 */

import { logger } from '../logger.js';
import { readEnvFile } from '../env.js';
import { registerChannel, ChannelOpts } from './registry.js';
import {
  Channel,
  NewMessage,
  OnChatMetadata,
  OnInboundMessage,
  RegisteredGroup,
} from '../types.js';

const LI_PREFIX = 'unipile-li:';
const EMAIL_PREFIX = 'unipile-email:';
const POLL_INTERVAL_MS = 60_000;

// ---------------------------------------------------------------------------
// Unipile REST client (thin wrapper around fetch)
// ---------------------------------------------------------------------------

class UnipileClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(dsn: string, apiKey: string) {
    this.baseUrl = `https://${dsn}/api/v1`;
    this.apiKey = apiKey;
  }

  private async request<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        'X-API-KEY': this.apiKey,
        'Content-Type': 'application/json',
        ...(options.headers ?? {}),
      },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `Unipile ${options.method ?? 'GET'} ${path} → ${res.status}: ${body}`,
      );
    }

    return res.json() as Promise<T>;
  }

  /** Fetch latest LinkedIn messages across all accounts. */
  async getLinkedInMessages(limit = 20): Promise<UnipileMessage[]> {
    const data = await this.request<{ items: UnipileMessage[] }>(
      `/messaging/messages?account_type=LINKEDIN&limit=${limit}`,
    );
    return data.items ?? [];
  }

  /** Fetch latest emails across all accounts. */
  async getEmails(limit = 20): Promise<UnipileEmail[]> {
    const data = await this.request<{ items: UnipileEmail[] }>(
      `/emails?limit=${limit}`,
    );
    return data.items ?? [];
  }

  /** Send a LinkedIn DM reply to a chat. */
  async sendLinkedInMessage(chatId: string, text: string): Promise<void> {
    await this.request(`/messaging/chats/${chatId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
  }

  /** Send an email reply. */
  async sendEmail(payload: UnipileEmailSend): Promise<void> {
    await this.request('/emails', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  /** Verify credentials by fetching account list. */
  async ping(): Promise<boolean> {
    try {
      await this.request('/accounts');
      return true;
    } catch {
      return false;
    }
  }
}

// ---------------------------------------------------------------------------
// Payload shapes (minimal — extend as needed)
// ---------------------------------------------------------------------------

interface UnipileMessage {
  id: string;
  chat_id: string;
  sender_id: string;
  sender_name?: string;
  text?: string;
  created_at: string;
  is_sender: boolean; // true when the message was sent by us
}

interface UnipileEmail {
  id: string;
  thread_id: string;
  from_attendee: { email: string; display_name?: string };
  subject?: string;
  body?: string;
  date: string;
  is_sender: boolean;
}

interface UnipileEmailSend {
  to: string;
  subject: string;
  body: string;
  thread_id?: string;
  in_reply_to?: string;
}

// ---------------------------------------------------------------------------
// Channel implementation
// ---------------------------------------------------------------------------

interface EmailMeta {
  from: string;
  fromName: string;
  subject: string;
  inReplyTo?: string;
}

export class UnipileChannel implements Channel {
  name = 'unipile';

  private client: UnipileClient;
  private opts: ChannelOpts;
  private connected = false;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private processedIds = new Set<string>();
  private emailMeta = new Map<string, EmailMeta>(); // thread_id → meta
  private consecutiveErrors = 0;

  constructor(client: UnipileClient, opts: ChannelOpts) {
    this.client = client;
    this.opts = opts;
  }

  // --- Channel interface ---

  async connect(): Promise<void> {
    const ok = await this.client.ping();
    if (!ok) {
      logger.warn('Unipile: credentials check failed — channel not started');
      return;
    }

    this.connected = true;
    logger.info('Unipile channel connected');

    await this.poll();
    this.schedulePoll();
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    if (jid.startsWith(LI_PREFIX)) {
      const chatId = jid.slice(LI_PREFIX.length);
      await this.client.sendLinkedInMessage(chatId, text);
      logger.info({ chatId }, 'Unipile LinkedIn message sent');
      return;
    }

    if (jid.startsWith(EMAIL_PREFIX)) {
      const threadId = jid.slice(EMAIL_PREFIX.length);
      const meta = this.emailMeta.get(threadId);
      if (!meta) {
        logger.warn(
          { jid },
          'Unipile: no email metadata for thread, cannot reply',
        );
        return;
      }
      const subject = meta.subject.startsWith('Re:')
        ? meta.subject
        : `Re: ${meta.subject}`;
      await this.client.sendEmail({
        to: meta.from,
        subject,
        body: text,
        thread_id: threadId,
        in_reply_to: meta.inReplyTo,
      });
      logger.info({ to: meta.from, subject }, 'Unipile email sent');
      return;
    }

    logger.warn({ jid }, 'Unipile: unknown JID prefix, cannot send');
  }

  isConnected(): boolean {
    return this.connected;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith(LI_PREFIX) || jid.startsWith(EMAIL_PREFIX);
  }

  async disconnect(): Promise<void> {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    this.connected = false;
    logger.info('Unipile channel disconnected');
  }

  // --- Polling ---

  private schedulePoll(): void {
    const backoffMs =
      this.consecutiveErrors > 0
        ? Math.min(
            POLL_INTERVAL_MS * Math.pow(2, this.consecutiveErrors),
            30 * 60_000,
          )
        : POLL_INTERVAL_MS;

    this.pollTimer = setTimeout(() => {
      this.poll()
        .catch((err) => logger.error({ err }, 'Unipile poll error'))
        .finally(() => {
          if (this.connected) this.schedulePoll();
        });
    }, backoffMs);
  }

  private async poll(): Promise<void> {
    try {
      await Promise.all([this.pollLinkedIn(), this.pollEmails()]);
      this.consecutiveErrors = 0;
    } catch (err) {
      this.consecutiveErrors++;
      logger.error(
        { err, consecutiveErrors: this.consecutiveErrors },
        'Unipile poll failed',
      );
    }
  }

  private async pollLinkedIn(): Promise<void> {
    const messages = await this.client.getLinkedInMessages();

    for (const msg of messages) {
      if (!msg.id || this.processedIds.has(msg.id)) continue;
      this.processedIds.add(msg.id);

      // Skip our own outgoing messages
      if (msg.is_sender) continue;

      const text = msg.text?.trim();
      if (!text) continue;

      const jid = `${LI_PREFIX}${msg.chat_id}`;
      const timestamp = msg.created_at;
      const senderName = msg.sender_name ?? msg.sender_id;

      this.opts.onChatMetadata(jid, timestamp, senderName, 'unipile', false);

      const groups = this.opts.registeredGroups();
      const targetJid = this.resolveTargetJid(jid, groups);
      if (!targetJid) continue;

      const newMsg: NewMessage = {
        id: msg.id,
        chat_jid: targetJid,
        sender: msg.sender_id,
        sender_name: senderName,
        content: `[LinkedIn DM from ${senderName}]\n\n${text}`,
        timestamp,
        is_from_me: false,
      };

      this.opts.onMessage(targetJid, newMsg);
      logger.info(
        { from: senderName, targetJid },
        'Unipile LinkedIn DM delivered',
      );
    }

    this.trimProcessedIds();
  }

  private async pollEmails(): Promise<void> {
    const emails = await this.client.getEmails();

    for (const email of emails) {
      if (!email.id || this.processedIds.has(email.id)) continue;
      this.processedIds.add(email.id);

      if (email.is_sender) continue;

      const body = email.body?.trim();
      if (!body) continue;

      const threadId = email.thread_id || email.id;
      const jid = `${EMAIL_PREFIX}${threadId}`;
      const { from_attendee, subject = '(no subject)', date } = email;
      const fromName = from_attendee.display_name ?? from_attendee.email;

      // Cache metadata for replies
      this.emailMeta.set(threadId, {
        from: from_attendee.email,
        fromName,
        subject,
      });

      this.opts.onChatMetadata(jid, date, subject, 'unipile', false);

      const groups = this.opts.registeredGroups();
      const targetJid = this.resolveTargetJid(jid, groups);
      if (!targetJid) continue;

      const newMsg: NewMessage = {
        id: email.id,
        chat_jid: targetJid,
        sender: from_attendee.email,
        sender_name: fromName,
        content: `[Email from ${fromName} <${from_attendee.email}>]\nSubject: ${subject}\n\n${body}`,
        timestamp: date,
        is_from_me: false,
      };

      this.opts.onMessage(targetJid, newMsg);
      logger.info(
        { from: fromName, subject, targetJid },
        'Unipile email delivered',
      );
    }

    this.trimProcessedIds();
  }

  /**
   * Resolve which NanoClaw group should receive this message.
   * If the jid is registered directly, use it.
   * Otherwise fall back to the main group (if any).
   */
  private resolveTargetJid(
    jid: string,
    groups: Record<string, RegisteredGroup>,
  ): string | null {
    if (groups[jid]) return jid;

    const mainEntry = Object.entries(groups).find(([, g]) => g.isMain);
    if (mainEntry) return mainEntry[0];

    logger.debug({ jid }, 'Unipile: no registered group to deliver message to');
    return null;
  }

  private trimProcessedIds(): void {
    if (this.processedIds.size > 5000) {
      const ids = [...this.processedIds];
      this.processedIds = new Set(ids.slice(ids.length - 2500));
    }
  }
}

// ---------------------------------------------------------------------------
// Self-registration
// ---------------------------------------------------------------------------

registerChannel('unipile', (opts: ChannelOpts): UnipileChannel | null => {
  const secrets = readEnvFile(['UNIPILE_API_KEY', 'UNIPILE_DSN']);
  const apiKey = process.env.UNIPILE_API_KEY ?? secrets.UNIPILE_API_KEY ?? '';
  const dsn = process.env.UNIPILE_DSN ?? secrets.UNIPILE_DSN ?? '';

  if (!apiKey || !dsn) {
    logger.warn(
      'Unipile: UNIPILE_API_KEY and UNIPILE_DSN not set — channel skipped. Add them to .env to enable.',
    );
    return null;
  }

  const client = new UnipileClient(dsn, apiKey);
  return new UnipileChannel(client, opts);
});
