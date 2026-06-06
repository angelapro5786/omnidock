import { normalizeDomain } from "./db";
import { RuntimeEnv } from "./http";

export type RuntimeRequirement = {
  kind: "binding" | "secret";
  name: string;
  message: string;
};

export function configuredAdminPassword(env: RuntimeEnv): string {
  return (env.ADMIN_PASSWORD ?? env.ADMIN_PASSWORD_BOOTSTRAP ?? "").trim();
}

export function configuredPrimaryDomain(env: RuntimeEnv): string | null {
  const domain = (env.PRIMARY_DOMAIN ?? env.DOMAINS?.split(",")[0] ?? "").trim();
  if (!domain || domain.toLowerCase() === "example.com") {
    return null;
  }

  try {
    return normalizeDomain(domain);
  } catch {
    return null;
  }
}

export function runtimeRequirements(env: RuntimeEnv, setupRequired: boolean): RuntimeRequirement[] {
  const requirements: RuntimeRequirement[] = [];

  if (!env.DB) {
    requirements.push({
      kind: "binding",
      name: "DB",
      message: "Add a D1 database binding named DB."
    });
  }

  if (!env.MAIL_BUCKET) {
    requirements.push({
      kind: "binding",
      name: "MAIL_BUCKET",
      message: "Add an R2 bucket binding named MAIL_BUCKET."
    });
  }

  if (!env.EMAIL) {
    requirements.push({
      kind: "binding",
      name: "EMAIL",
      message: "Add a Cloudflare Email Sending binding named EMAIL."
    });
  }

  if (setupRequired && !configuredAdminPassword(env)) {
    requirements.push({
      kind: "secret",
      name: "ADMIN_PASSWORD",
      message: "Add the first admin password as a Worker secret named ADMIN_PASSWORD."
    });
  }

  if (setupRequired && !configuredPrimaryDomain(env)) {
    requirements.push({
      kind: "secret",
      name: "PRIMARY_DOMAIN",
      message: "Add the first managed email domain as a Worker secret named PRIMARY_DOMAIN."
    });
  }

  return requirements;
}
