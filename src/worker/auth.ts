import { ApiError, RuntimeEnv } from "./http";

const encoder = new TextEncoder();
const PASSWORD_ITERATIONS = 100_000;

type AdminAuthRow = {
  password_hash: string;
  password_salt: string;
  password_iterations: number;
};

export async function requireAdmin(request: Request, env: RuntimeEnv): Promise<void> {
  await ensureAdminAuthTable(env);

  const provided = extractPassword(request);
  const record = await getAdminAuth(env);

  if (!record) {
    await bootstrapPassword(env, provided);
    return;
  }

  if (!provided || !(await verifyPassword(provided, record))) {
    throw new ApiError(401, "unauthorized", "Invalid password");
  }
}

export async function setAdminPassword(env: RuntimeEnv, password: string): Promise<void> {
  if (password.length < 12) {
    throw new ApiError(400, "weak_password", "Password must be at least 12 characters");
  }

  await ensureAdminAuthTable(env);
  const salt = randomSalt();
  const hash = await hashPassword(password, salt, PASSWORD_ITERATIONS);

  await env.DB.prepare(
    `INSERT INTO admin_auth (id, password_hash, password_salt, password_iterations)
     VALUES ('primary', ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       password_hash = excluded.password_hash,
       password_salt = excluded.password_salt,
       password_iterations = excluded.password_iterations,
       updated_at = CURRENT_TIMESTAMP`
  )
    .bind(hash, salt, PASSWORD_ITERATIONS)
    .run();
}

function extractPassword(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (authorization?.toLowerCase().startsWith("bearer ")) {
    return authorization.slice(7);
  }

  const headerPassword = request.headers.get("x-admin-password");
  if (headerPassword) {
    return headerPassword;
  }

  return null;
}

async function bootstrapPassword(env: RuntimeEnv, provided: string | null): Promise<void> {
  const bootstrap = env.ADMIN_PASSWORD_BOOTSTRAP;
  if (!bootstrap) {
    throw new ApiError(
      503,
      "admin_password_unset",
      "Admin password is not initialized. Set ADMIN_PASSWORD_BOOTSTRAP once, then log in to store it in D1."
    );
  }

  if (!provided || !(await securePlainEqual(provided, bootstrap))) {
    throw new ApiError(401, "unauthorized", "Invalid password");
  }

  await setAdminPassword(env, bootstrap);
}

async function getAdminAuth(env: RuntimeEnv): Promise<AdminAuthRow | null> {
  return (
    (await env.DB.prepare(
      "SELECT password_hash, password_salt, password_iterations FROM admin_auth WHERE id = 'primary'"
    ).first<AdminAuthRow>()) ?? null
  );
}

async function ensureAdminAuthTable(env: RuntimeEnv): Promise<void> {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS admin_auth (
      id TEXT PRIMARY KEY CHECK (id = 'primary'),
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      password_iterations INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  ).run();
}

async function verifyPassword(password: string, record: AdminAuthRow): Promise<boolean> {
  const hash = await hashPassword(password, record.password_salt, record.password_iterations);
  return secureStringEqual(hash, record.password_hash);
}

async function hashPassword(password: string, salt: string, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: base64ToArrayBuffer(salt),
      iterations
    },
    key,
    256
  );

  return bytesToBase64(new Uint8Array(bits));
}

async function securePlainEqual(provided: string, expected: string): Promise<boolean> {
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected))
  ]);

  const left = new Uint8Array(providedHash);
  const right = new Uint8Array(expectedHash);
  return secureBytesEqual(left, right) && provided.length === expected.length;
}

function secureStringEqual(left: string, right: string): boolean {
  return secureBytesEqual(encoder.encode(left), encoder.encode(right)) && left.length === right.length;
}

function secureBytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  let diff = 0;
  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    diff |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }

  return diff === 0 && left.length === right.length;
}

function randomSalt(): string {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  return bytesToBase64(salt);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(value: string): ArrayBuffer {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}
