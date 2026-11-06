/** TRAE CLI credentials stay on the machine running the server, never in a Project or DTO. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export class TraeAuthError extends Error {
  readonly status = 401;
  constructor(message: string) {
    super(message);
    this.name = "AuthenticationError";
  }
}

export function traeCliHome(): string {
  return (
    process.env.TRAECLI_HOME ??
    path.join(process.env.TRAE_HOME ?? path.join(os.homedir(), ".trae"), "cli")
  );
}

export function traeAuthPath(): string {
  return process.env.TRAE_AUTH_FILE ?? path.join(traeCliHome(), "auth.json");
}

export interface TraeAuth {
  token: string;
  expiresAt?: string;
  updatedAt: string;
}

/** Read afresh for every request so logging in again also repairs an existing Session. */
export function readTraeAuth(): TraeAuth {
  let raw: { trae?: { access_token?: unknown; expires_at?: unknown; region?: unknown } };
  let updatedAt: string;
  try {
    const file = traeAuthPath();
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
    updatedAt = fs.statSync(file).mtime.toISOString();
  } catch {
    throw new TraeAuthError(
      "TRAE login is unavailable. Run `traecli login` on the server machine and retry.",
    );
  }
  const token = raw?.trae?.access_token;
  if (typeof token !== "string" || !token.trim()) {
    throw new TraeAuthError(
      "No TRAE access token. Run `traecli login` on the server machine and retry.",
    );
  }
  const expiresAt = raw.trae?.expires_at;
  if (
    typeof expiresAt === "string" &&
    (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now())
  ) {
    throw new TraeAuthError("TRAE access token has expired. Run `traecli login` and retry.");
  }
  if (raw.trae?.region && raw.trae.region !== "CN") {
    throw new TraeAuthError(
      "This TRAE connection requires a CN login. Run `traecli login` for the CN service.",
    );
  }
  return { token, updatedAt, ...(typeof expiresAt === "string" ? { expiresAt } : {}) };
}

export function traeAuthStatus(): { available: boolean; expiresAt?: string; updatedAt?: string } {
  try {
    const { token: _, ...status } = readTraeAuth();
    return { available: true, ...status };
  } catch {
    return { available: false };
  }
}
