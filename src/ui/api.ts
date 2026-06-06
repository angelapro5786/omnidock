import {
  BootstrapPayload,
  BucketObjectsPayload,
  ContactRow,
  DomainRow,
  ExternalAccountRow,
  SetupStatusPayload,
  ThreadPayload,
  ThreadRow
} from "./types";

export type AttachmentDraft = {
  filename: string;
  contentType: string;
  contentBase64: string;
  size: number;
};

export type ContactInput = {
  email: string;
  name?: string | null;
  company?: string | null;
  phone?: string | null;
  tags?: string | null;
  notes?: string | null;
};

export type ContactImportReport = {
  imported: number;
  created: number;
  updated: number;
  skipped: number;
  rows: {
    email: string;
    status: "created" | "updated" | "skipped";
    message?: string;
  }[];
};

export type ExternalAccountInput = {
  provider: string;
  email: string;
  displayName?: string | null;
  username?: string | null;
  authType: string;
  credentialSecretName?: string | null;
  imapHost?: string | null;
  imapPort?: number | null;
  imapSecurity: string;
  smtpHost?: string | null;
  smtpPort?: number | null;
  smtpSecurity: string;
  inboundEnabled: boolean;
  outboundEnabled: boolean;
  notes?: string | null;
};

export function setupStatus(): Promise<SetupStatusPayload> {
  return publicRequest<SetupStatusPayload>("/api/setup/status");
}

export function createAdmin(input: {
  name: string;
  email: string;
  recoveryEmail: string;
  primaryDomain: string;
  password?: string | null;
}): Promise<{ ok: true }> {
  return publicRequest("/api/setup", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function requestPasswordReset(email: string): Promise<{ ok: true }> {
  return publicRequest("/api/auth/reset/request", {
    method: "POST",
    body: JSON.stringify({ email })
  });
}

export function confirmPasswordReset(input: { token: string; password: string }): Promise<{ ok: true }> {
  return publicRequest("/api/auth/reset/confirm", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export class ApiClient {
  constructor(private readonly password: string) {}

  bootstrap(): Promise<BootstrapPayload> {
    return this.request<BootstrapPayload>("/api/bootstrap");
  }

  threads(
    folder: string,
    mailboxId: string | null,
    query: string
  ): Promise<{ ok: true; threads: ThreadRow[]; stats: Record<string, number> }> {
    const params = new URLSearchParams({ folder });
    if (mailboxId) params.set("mailboxId", mailboxId);
    if (query.trim()) params.set("q", query.trim());
    return this.request<{ ok: true; threads: ThreadRow[]; stats: Record<string, number> }>(`/api/threads?${params.toString()}`);
  }

  thread(threadId: string): Promise<ThreadPayload> {
    return this.request<ThreadPayload>(`/api/threads/${threadId}`);
  }

  addDomain(domain: string): Promise<{ ok: true; domain: DomainRow }> {
    return this.request("/api/domains", {
      method: "POST",
      body: JSON.stringify({ domain })
    });
  }

  setDefaultDomain(domainId: string): Promise<{ ok: true; domain: DomainRow }> {
    return this.request(`/api/domains/${domainId}/default`, { method: "POST" });
  }

  syncCloudflare(): Promise<unknown> {
    return this.request("/api/sync/cloudflare", { method: "POST" });
  }

  enableCatchAll(domainId: string): Promise<unknown> {
    return this.request(`/api/domains/${domainId}/catch-all`, { method: "POST" });
  }

  createMailbox(domainId: string, localPart: string, displayName: string | null, createRule: boolean): Promise<unknown> {
    return this.request("/api/mailboxes", {
      method: "POST",
      body: JSON.stringify({ domainId, localPart, displayName, createRule })
    });
  }

  enableMailboxRouting(mailboxId: string): Promise<unknown> {
    return this.request(`/api/mailboxes/${mailboxId}/routing-rule`, { method: "POST" });
  }

  saveSignature(mailboxId: string, input: { textSignature: string; htmlSignature?: string | null; enabled: boolean }): Promise<unknown> {
    return this.request(`/api/mailboxes/${mailboxId}/signature`, {
      method: "PUT",
      body: JSON.stringify(input)
    });
  }

  addContact(input: ContactInput): Promise<{ ok: true; contact: ContactRow }> {
    return this.request("/api/contacts", {
      method: "POST",
      body: JSON.stringify(input)
    });
  }

  saveContact(input: ContactInput, id?: string | null): Promise<{ ok: true; contact: ContactRow }> {
    return this.request(id ? `/api/contacts/${id}` : "/api/contacts", {
      method: id ? "PUT" : "POST",
      body: JSON.stringify(input)
    });
  }

  deleteContact(id: string): Promise<unknown> {
    return this.request(`/api/contacts/${id}`, { method: "DELETE" });
  }

  importContacts(contacts: ContactInput[], source = "upload"): Promise<{ ok: true; report: ContactImportReport }> {
    return this.request("/api/contacts/import", {
      method: "POST",
      body: JSON.stringify({ contacts, source })
    });
  }

  saveExternalAccount(input: ExternalAccountInput, id?: string | null): Promise<{ ok: true; account: ExternalAccountRow }> {
    return this.request(id ? `/api/external-accounts/${id}` : "/api/external-accounts", {
      method: id ? "PUT" : "POST",
      body: JSON.stringify(input)
    });
  }

  deleteExternalAccount(id: string): Promise<unknown> {
    return this.request(`/api/external-accounts/${id}`, { method: "DELETE" });
  }

  patchThread(threadId: string, action: "read" | "archive" | "unarchive"): Promise<unknown> {
    return this.request(`/api/threads/${threadId}`, {
      method: "PATCH",
      body: JSON.stringify({ action })
    });
  }

  deleteThread(threadId: string): Promise<unknown> {
    return this.request(`/api/threads/${threadId}`, { method: "DELETE" });
  }

  send(input: {
    from: string;
    to: string;
    subject: string;
    text: string;
    html?: string | null;
    replyToThreadId?: string;
    attachments?: AttachmentDraft[];
  }): Promise<unknown> {
    const path = input.replyToThreadId ? `/api/threads/${input.replyToThreadId}/reply` : "/api/send";
    return this.request(path, {
      method: "POST",
      body: JSON.stringify(input)
    });
  }

  changePassword(password: string): Promise<unknown> {
    return this.request("/api/auth/password", {
      method: "PUT",
      body: JSON.stringify({ password })
    });
  }

  async downloadAttachment(id: string): Promise<Blob> {
    const response = await fetch(`/api/attachments/${id}`, {
      headers: {
        authorization: `Bearer ${this.password}`
      }
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
      throw new ApiRequestError(response.status, payload?.error?.message ?? `Download failed with ${response.status}`);
    }
    return response.blob();
  }

  listBucketObjects(bucketId: string, prefix: string, cursor?: string | null): Promise<BucketObjectsPayload> {
    const params = new URLSearchParams();
    if (prefix) params.set("prefix", prefix);
    if (cursor) params.set("cursor", cursor);
    const suffix = params.toString() ? `?${params.toString()}` : "";
    return this.request<BucketObjectsPayload>(`/api/buckets/${encodeURIComponent(bucketId)}/objects${suffix}`);
  }

  async downloadBucketObject(bucketId: string, key: string): Promise<Blob> {
    const response = await fetch(`/api/buckets/${encodeURIComponent(bucketId)}/object?key=${encodeURIComponent(key)}`, {
      headers: {
        authorization: `Bearer ${this.password}`
      }
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
      throw new ApiRequestError(response.status, payload?.error?.message ?? `Download failed with ${response.status}`);
    }
    return response.blob();
  }

  async uploadBucketObject(bucketId: string, key: string, file: File): Promise<unknown> {
    const response = await fetch(`/api/buckets/${encodeURIComponent(bucketId)}/object?key=${encodeURIComponent(key)}`, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${this.password}`,
        "content-type": file.type || "application/octet-stream"
      },
      body: file
    });
    return readApiResponse(response);
  }

  async deleteBucketObject(bucketId: string, key: string): Promise<unknown> {
    const response = await fetch(`/api/buckets/${encodeURIComponent(bucketId)}/object?key=${encodeURIComponent(key)}`, {
      method: "DELETE",
      headers: {
        authorization: `Bearer ${this.password}`
      }
    });
    return readApiResponse(response);
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(path, {
      ...init,
      headers: {
        authorization: `Bearer ${this.password}`,
        "content-type": "application/json",
        ...(init.headers ?? {})
      }
    });

    const payload = (await response.json().catch(() => null)) as
      | { ok?: boolean; error?: { message?: string } }
      | null;

    if (!response.ok || payload?.ok === false) {
      throw new ApiRequestError(response.status, payload?.error?.message ?? `Request failed with ${response.status}`);
    }

    return payload as T;
  }
}

async function readApiResponse<T = unknown>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => null)) as
    | { ok?: boolean; error?: { message?: string } }
    | null;

  if (!response.ok || payload?.ok === false) {
    throw new ApiRequestError(response.status, payload?.error?.message ?? `Request failed with ${response.status}`);
  }

  return payload as T;
}

async function publicRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {})
    }
  });

  const payload = (await response.json().catch(() => null)) as
    | { ok?: boolean; error?: { message?: string } }
    | null;

  if (!response.ok || payload?.ok === false) {
    throw new ApiRequestError(response.status, payload?.error?.message ?? `Request failed with ${response.status}`);
  }

  return payload as T;
}

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}
