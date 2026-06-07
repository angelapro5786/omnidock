import { connect } from "cloudflare:sockets";
import PostalMime from "postal-mime";
import {
  createId,
  domainFromEmail,
  findThreadForHeaders,
  insertAttachment,
  insertMessage,
  markExternalAccountChecked,
  messageExistsByMessageId,
  normalizeEmail,
  nowIso,
  recordAudit,
  type ExternalAccountRow
} from "./db";
import { ApiError, RuntimeEnv, isRecord } from "./http";
import { ensureDatabaseSchema } from "./schema";

type SyncOptions = {
  limit?: number;
};

export type ExternalSyncResult = {
  imported: number;
  skipped: number;
  checked: number;
  folders: string[];
  hasMore: boolean;
};

type ParsedAddress = {
  address?: string;
  name?: string;
};

type ImapFolder = {
  name: string;
  attributes: string[];
};

const DEFAULT_SYNC_LIMIT = 300;
const MAX_SYNC_LIMIT = 800;
const SYNC_TIME_BUDGET_MS = 22_000;

export async function syncExternalAccount(
  env: RuntimeEnv,
  account: ExternalAccountRow,
  options: SyncOptions = {}
): Promise<ExternalSyncResult> {
  await ensureDatabaseSchema(env);

  if (account.inbound_enabled !== 1) {
    throw new ApiError(400, "external_inbound_disabled", "Inbound sync is disabled for this external account");
  }
  if (account.auth_type !== "app_password") {
    throw new ApiError(400, "external_auth_unsupported", "Only app-password IMAP sync is supported right now");
  }
  if (!account.imap_host || !account.imap_port) {
    throw new ApiError(400, "external_imap_missing", "IMAP host and port are required before syncing old emails");
  }

  const password = externalCredential(env, account);
  const startedAt = Date.now();
  const limit = Math.min(Math.max(options.limit ?? DEFAULT_SYNC_LIMIT, 1), MAX_SYNC_LIMIT);
  let folders = externalSyncFolders(account.provider);
  let imported = 0;
  let skipped = 0;
  let checked = 0;
  let hasMore = false;

  const imap = await ImapClient.open({
    host: account.imap_host,
    port: account.imap_port,
    security: account.imap_security
  });

  try {
    await imap.login(account.username || account.email, password);
    folders = externalSyncFolders(account.provider, await imap.listFolders());

    for (const folder of folders) {
      const selected = await imap.examine(folder);
      if (!selected) continue;

      const uids = await imap.searchAll();
      const newestFirst = [...uids].sort((a, b) => b - a);
      const sentFolder = isSentFolder(folder);

      for (const uid of newestFirst) {
        if (imported >= limit || Date.now() - startedAt > SYNC_TIME_BUDGET_MS) {
          hasMore = true;
          break;
        }

        const raw = await imap.fetchRaw(uid);
        checked += 1;
        if (!raw) {
          skipped += 1;
          continue;
        }

        const stored = await storeExternalRawMessage(env, account, raw, sentFolder);
        if (stored) {
          imported += 1;
        } else {
          skipped += 1;
        }
      }

      if (hasMore) break;
    }
  } finally {
    await imap.logout();
  }

  await markExternalAccountChecked(env, account.id, "configured");
  await recordAudit(env, "external_account.synced", account.id, { email: account.email, imported, skipped, checked });

  return { imported, skipped, checked, folders, hasMore };
}

async function storeExternalRawMessage(
  env: RuntimeEnv,
  account: ExternalAccountRow,
  raw: Uint8Array,
  sentFolder: boolean
): Promise<boolean> {
  const parsed = await PostalMime.parse(raw);
  const mailbox = normalizeEmail(account.email);
  const messageId = parsed.messageId || `external:${account.id}:${await sha256Hex(raw)}`;
  if (await messageExistsByMessageId(env, messageId)) {
    return false;
  }

  const subject = parsed.subject ?? "";
  const textBody = parsed.text ?? null;
  const htmlBody = parsed.html ?? null;
  const sender = parsed.from && isRecord(parsed.from) ? (parsed.from as ParsedAddress) : null;
  const fromAddress = safeNormalizeEmail(sender?.address, mailbox);
  const to = addressListFromParsed(parsed.to, mailbox);
  const cc = addressListFromParsed(parsed.cc, "");
  const date = parseEmailDate(parsed.date);
  const threadId =
    (await findThreadForHeaders(env, {
      inReplyTo: parsed.inReplyTo ?? null,
      references: parsed.references ?? null,
      subject,
      mailbox
    })) ?? createId("thr");

  const rawR2Key = buildObjectKey("raw", mailbox, "external.eml");
  await env.MAIL_BUCKET.put(rawR2Key, raw, {
    httpMetadata: {
      contentType: "message/rfc822"
    },
    customMetadata: {
      mailbox,
      from: fromAddress,
      subject: subject.slice(0, 256),
      source: "external-imap"
    }
  });

  const stored = await insertMessage(env, {
    threadId,
    direction: sentFolder ? "outbound" : "inbound",
    mailbox,
    domain: domainFromEmail(mailbox),
    fromAddress,
    fromName: sender?.name ?? null,
    to,
    cc,
    subject,
    snippet: makeSnippet(textBody ?? htmlToText(htmlBody ?? "")),
    textBody,
    htmlBody,
    messageId,
    inReplyTo: parsed.inReplyTo ?? null,
    referencesHeader: parsed.references ?? null,
    rawR2Key,
    sentStatus: sentFolder ? "sent" : null,
    readAt: sentFolder ? nowIso() : null,
    receivedAt: date,
    createdAt: date
  });

  for (const attachment of parsed.attachments ?? []) {
    const filename = attachment.filename || "attachment";
    const contentType = attachment.mimeType || "application/octet-stream";
    const r2Key = buildObjectKey("attachments", mailbox, filename);
    const content = attachment.content;
    const size = attachmentSize(content);

    await env.MAIL_BUCKET.put(r2Key, content, {
      httpMetadata: {
        contentType
      },
      customMetadata: {
        messageId: stored.id,
        filename,
        source: "external-imap"
      }
    });

    await insertAttachment(env, {
      messageId: stored.id,
      filename,
      contentType,
      size,
      r2Key,
      disposition: attachment.disposition ?? null,
      contentId: attachment.contentId ?? null
    });
  }

  return true;
}

class ImapClient {
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private writer: WritableStreamDefaultWriter<Uint8Array>;
  private buffer = new Uint8Array(0);
  private tagCounter = 1;

  private constructor(private socket: Socket) {
    this.reader = socket.readable.getReader();
    this.writer = socket.writable.getWriter();
  }

  static async open(input: { host: string; port: number; security: string }): Promise<ImapClient> {
    const secureTransport = input.security === "ssl" ? "on" : input.security === "starttls" ? "starttls" : "off";
    const socket = connect(
      { hostname: input.host, port: input.port },
      { secureTransport, allowHalfOpen: false }
    );
    await socket.opened;
    let client = new ImapClient(socket);
    await client.readGreeting();

    if (input.security === "starttls") {
      await client.command("STARTTLS");
      const tlsSocket = socket.startTls({ expectedServerHostname: input.host });
      await tlsSocket.opened;
      client.release();
      client = new ImapClient(tlsSocket);
    }

    return client;
  }

  async login(username: string, password: string): Promise<void> {
    await this.command(`LOGIN ${quoteImapString(username)} ${quoteImapString(password)}`);
  }

  async examine(folder: string): Promise<boolean> {
    try {
      await this.command(`EXAMINE ${quoteImapString(folder)}`);
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.code === "imap_command_failed") {
        return false;
      }
      throw error;
    }
  }

  async searchAll(): Promise<number[]> {
    const response = await this.command("UID SEARCH ALL");
    const line = response.text.split(/\r\n/).find((item) => item.toUpperCase().startsWith("* SEARCH "));
    if (!line) return [];
    return line
      .slice("* SEARCH ".length)
      .trim()
      .split(/\s+/)
      .map((item) => Number.parseInt(item, 10))
      .filter((uid) => Number.isInteger(uid) && uid > 0);
  }

  async listFolders(): Promise<ImapFolder[]> {
    const response = await this.command('LIST "" "*"');
    return response.text
      .split(/\r\n/)
      .map(parseListLine)
      .filter((folder): folder is ImapFolder => Boolean(folder));
  }

  async fetchRaw(uid: number): Promise<Uint8Array | null> {
    const response = await this.command(`UID FETCH ${uid} (BODY.PEEK[])`);
    return response.literals.sort((a, b) => b.byteLength - a.byteLength)[0] ?? null;
  }

  async logout(): Promise<void> {
    try {
      await this.command("LOGOUT");
    } catch {
      // The server may close after LOGOUT; close below is enough.
    }
    this.release();
    await this.socket.close().catch(() => undefined);
  }

  private async readGreeting(): Promise<void> {
    const line = await this.readLine();
    if (!line.toUpperCase().startsWith("* OK")) {
      throw new ApiError(502, "imap_greeting_failed", "IMAP server did not return an OK greeting");
    }
  }

  private async command(command: string): Promise<{ text: string; literals: Uint8Array[] }> {
    const tag = `A${String(this.tagCounter++).padStart(4, "0")}`;
    await this.writer.write(new TextEncoder().encode(`${tag} ${command}\r\n`));
    const response = await this.readTagged(tag);
    const statusLine = response.text.split(/\r\n/).find((line) => line.startsWith(`${tag} `)) ?? "";
    if (!new RegExp(`^${tag} OK\\b`, "i").test(statusLine)) {
      throw new ApiError(502, "imap_command_failed", sanitizeImapStatus(statusLine || "IMAP command failed"));
    }
    return response;
  }

  private async readTagged(tag: string): Promise<{ text: string; literals: Uint8Array[] }> {
    const literals: Uint8Array[] = [];
    let text = "";

    for (;;) {
      const line = await this.readLine();
      text += `${line}\r\n`;

      const literalMatch = line.match(/\{(\d+)\}$/);
      if (literalMatch) {
        const literal = await this.readBytes(Number.parseInt(literalMatch[1], 10));
        literals.push(literal);
        text += `{literal:${literal.byteLength}}\r\n`;
      }

      if (line.startsWith(`${tag} `)) {
        return { text, literals };
      }
    }
  }

  private async readLine(): Promise<string> {
    for (;;) {
      const index = indexOfCrlf(this.buffer);
      if (index >= 0) {
        const lineBytes = this.buffer.slice(0, index);
        this.buffer = this.buffer.slice(index + 2);
        return new TextDecoder().decode(lineBytes);
      }
      await this.readMore();
    }
  }

  private async readBytes(length: number): Promise<Uint8Array> {
    while (this.buffer.byteLength < length) {
      await this.readMore();
    }
    const bytes = this.buffer.slice(0, length);
    this.buffer = this.buffer.slice(length);
    return bytes;
  }

  private async readMore(): Promise<void> {
    const chunk = await this.reader.read();
    if (chunk.done || !chunk.value) {
      throw new ApiError(502, "imap_connection_closed", "IMAP connection closed unexpectedly");
    }
    const merged = new Uint8Array(this.buffer.byteLength + chunk.value.byteLength);
    merged.set(this.buffer, 0);
    merged.set(chunk.value, this.buffer.byteLength);
    this.buffer = merged;
  }

  private release(): void {
    this.reader.releaseLock();
    this.writer.releaseLock();
  }
}

function externalCredential(env: RuntimeEnv, account: ExternalAccountRow): string {
  const secretName = (account.credential_secret_name || account.email).trim();
  const value = (env as unknown as Record<string, unknown>)[secretName];
  if (typeof value !== "string" || !value.trim()) {
    throw new ApiError(409, "external_secret_missing", `Add a Worker secret named ${secretName} with this account's app password.`);
  }
  return value.trim();
}

function externalSyncFolders(provider: string, discovered: ImapFolder[] = []): string[] {
  const sent = discovered.find((folder) => folder.attributes.some((attribute) => attribute.toLowerCase() === "\\sent"))?.name;
  const fallback =
    provider === "gmail"
      ? "[Gmail]/Sent Mail"
      : provider === "outlook"
        ? "Sent Items"
        : provider === "icloud"
          ? "Sent Messages"
          : "Sent";
  return uniqueStrings(["INBOX", sent, fallback].filter(Boolean) as string[]);
}

function isSentFolder(folder: string): boolean {
  return /sent/i.test(folder);
}

function quoteImapString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\r\n]/g, " ")}"`;
}

function sanitizeImapStatus(value: string): string {
  return value.replace(/^A\d+\s+/i, "").slice(0, 220) || "IMAP command failed";
}

function parseListLine(line: string): ImapFolder | null {
  if (!line.toUpperCase().startsWith("* LIST ")) return null;
  const attributes = line.match(/\(([^)]*)\)/)?.[1].split(/\s+/).filter(Boolean) ?? [];
  const name = lastQuotedString(line) ?? line.split(/\s+/).at(-1)?.trim();
  if (!name || name === "NIL") return null;
  return { name, attributes };
}

function lastQuotedString(line: string): string | null {
  let end = -1;
  for (let index = line.length - 1; index >= 0; index -= 1) {
    if (line[index] === '"' && line[index - 1] !== "\\") {
      end = index;
      break;
    }
  }
  if (end < 0) return null;

  let start = -1;
  for (let index = end - 1; index >= 0; index -= 1) {
    if (line[index] === '"' && line[index - 1] !== "\\") {
      start = index;
      break;
    }
  }
  if (start < 0) return null;

  return line.slice(start + 1, end).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function indexOfCrlf(bytes: Uint8Array): number {
  for (let index = 0; index < bytes.byteLength - 1; index += 1) {
    if (bytes[index] === 13 && bytes[index + 1] === 10) return index;
  }
  return -1;
}

function addressListFromParsed(value: unknown, fallback: string): string[] {
  const fallbackAddress = normalizeEmail(fallback);
  if (Array.isArray(value)) {
    const addresses = value
      .flatMap((entry) => {
        if (isRecord(entry) && typeof entry.address === "string") {
          return [entry.address];
        }
        if (isRecord(entry) && Array.isArray(entry.group)) {
          return entry.group.flatMap((member) => (isRecord(member) && typeof member.address === "string" ? [member.address] : []));
        }
        if (typeof entry === "string") {
          return [entry];
        }
        return [];
      })
      .filter(Boolean)
      .map((address) => safeNormalizeEmail(address, ""))
      .filter(Boolean);
    return addresses.length > 0 ? addresses : [fallbackAddress];
  }

  if (fallback) {
    return [fallbackAddress];
  }

  return [];
}

function safeNormalizeEmail(value: string | null | undefined, fallback: string): string {
  if (value) {
    try {
      return normalizeEmail(value);
    } catch {
      // Old mailboxes can contain malformed display addresses; keep the sync moving.
    }
  }
  return fallback ? normalizeEmail(fallback) : "";
}

function attachmentSize(content: string | ArrayBuffer | Uint8Array): number {
  if (typeof content === "string") return new TextEncoder().encode(content).byteLength;
  return content.byteLength;
}

function buildObjectKey(kind: "raw" | "attachments", mailbox: string, filename: string): string {
  const safeMailbox = mailbox.replace(/[^a-z0-9@._-]/gi, "_");
  const safeFilename = filename.replace(/[^a-z0-9._-]/gi, "_").slice(0, 128);
  const date = new Date().toISOString().slice(0, 10);
  return `${kind}/${date}/${safeMailbox}/${crypto.randomUUID()}-${safeFilename}`;
}

function makeSnippet(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 240);
}

function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function parseEmailDate(value: string | undefined): string {
  if (!value) return nowIso();
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : nowIso();
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
