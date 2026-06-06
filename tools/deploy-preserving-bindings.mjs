import { spawnSync } from "node:child_process";
import fs from "node:fs";

const CONFIG_PATH = "wrangler.jsonc";
const GENERATED_CONFIG_PATH = ".wrangler.omnidock.generated.jsonc";
const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";
const PLACEHOLDER_D1_ID = "00000000-0000-0000-0000-000000000000";
const PLACEHOLDER_R2_BUCKET = "omnidock-mail";
const RESERVED_R2_BINDINGS = new Set(["ASSETS", "DB", "EMAIL", "MAIL_BUCKET"]);

const baseConfig = readJsonc(CONFIG_PATH);
const generatedConfig = structuredClone(baseConfig);
generatedConfig.keep_vars = true;

const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
const workerName = envValue("WORKER_SCRIPT_NAME") || generatedConfig.name;
generatedConfig.name = workerName;
const preservedResourceBindings = configuredResourceBindings(generatedConfig);
const d1DatabaseId = envValue("OMNIDOCK_D1_DATABASE_ID");
const d1DatabaseName = envValue("OMNIDOCK_D1_DATABASE_NAME") || "omnidock-db";
const r2BucketName = envValue("OMNIDOCK_R2_BUCKET_NAME");
const extraR2Buckets = parseExtraR2Buckets(envValue("OMNIDOCK_EXTRA_R2_BUCKETS"));

if (d1DatabaseId) {
  generatedConfig.d1_databases = [
    {
      binding: "DB",
      database_name: d1DatabaseName,
      database_id: d1DatabaseId,
      migrations_dir: "migrations"
    }
  ];
  preservedResourceBindings.add("DB");
}

if (r2BucketName) {
  upsertR2Bucket(generatedConfig, {
    binding: "MAIL_BUCKET",
    bucket_name: r2BucketName
  });
  preservedResourceBindings.add("MAIL_BUCKET");
}

for (const bucket of extraR2Buckets) {
  upsertR2Bucket(generatedConfig, bucket);
  preservedResourceBindings.add(bucket.binding);
}
syncR2DisplayVars(generatedConfig);

if (token && workerName) {
  try {
    const accountId = await configuredAccountId(token);
    if (accountId) {
      const bindings = await fetchWorkerBindings(token, accountId, workerName);
      for (const bindingName of mergeCloudflareBindings(generatedConfig, bindings)) {
        preservedResourceBindings.add(bindingName);
      }
      syncR2DisplayVars(generatedConfig);
    }
  } catch (error) {
    console.warn(`OmniDock could not read existing Worker bindings: ${readError(error)}`);
  }
} else {
  console.warn("OmniDock could not read existing Worker bindings because CLOUDFLARE_API_TOKEN is not available at build time.");
}

fs.writeFileSync(GENERATED_CONFIG_PATH, `${JSON.stringify(generatedConfig, null, 2)}\n`);

const dryRun = envFlag("OMNIDOCK_DEPLOY_DRY_RUN");
const args = ["wrangler", "deploy", "--config", GENERATED_CONFIG_PATH, "--keep-vars"];
if (dryRun) {
  args.push("--dry-run");
}

const requiredResourceBindings = ["DB", "MAIL_BUCKET"];
const missingResourceBindings = requiredResourceBindings.filter((binding) => !preservedResourceBindings.has(binding));
if (missingResourceBindings.length > 0) {
  const allowUnboundDeploy = envFlag("OMNIDOCK_ALLOW_UNBOUND_DEPLOY");

  if (!allowUnboundDeploy) {
    console.error("OmniDock stopped this deploy before Wrangler could remove dashboard resource bindings.");
    console.error(`Missing generated binding(s): ${missingResourceBindings.join(", ")}`);
    console.error("Add OMNIDOCK_D1_DATABASE_ID and OMNIDOCK_R2_BUCKET_NAME as Cloudflare build/deploy variables or secrets, then deploy again.");
    console.error("Alternatively expose CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID to the build so OmniDock can read existing Worker bindings.");
    console.error("Set OMNIDOCK_ALLOW_UNBOUND_DEPLOY=1 only for an intentional first deploy without D1/R2 bindings.");
    process.exit(1);
  }

  console.warn(`OmniDock deploy is missing generated resource binding(s): ${missingResourceBindings.join(", ")}.`);
  console.warn("This is allowed only because OMNIDOCK_ALLOW_UNBOUND_DEPLOY=1 is set.");
} else {
  console.log(`OmniDock preserved ${preservedResourceBindings.size} DB/R2 binding(s) for this deploy.`);
}

const result = spawnSync("npx", args, { stdio: "inherit" });
process.exit(result.status ?? 1);

function mergeCloudflareBindings(config, bindings) {
  const preserved = [];
  const d1 = bindings.find((binding) => binding.type === "d1" && binding.name === "DB" && binding.id);
  if (d1) {
    config.d1_databases = [
      {
        binding: "DB",
        database_name: d1.database_name || "omnidock-db",
        database_id: d1.id,
        migrations_dir: "migrations"
      }
    ];
    preserved.push("DB");
  }

  const r2Bindings = bindings.filter((binding) => binding.type === "r2_bucket" && binding.name && binding.bucket_name);
  for (const r2 of r2Bindings) {
    upsertR2Bucket(config, {
      binding: r2.name,
      bucket_name: r2.bucket_name,
      ...(r2.jurisdiction ? { jurisdiction: r2.jurisdiction } : {})
    });
    preserved.push(r2.name);
  }

  return preserved;
}

function configuredResourceBindings(config) {
  const names = new Set();
  const d1 = Array.isArray(config.d1_databases)
    ? config.d1_databases.find((item) => item?.binding === "DB" && item.database_id && item.database_id !== PLACEHOLDER_D1_ID)
    : null;
  if (d1) {
    names.add("DB");
  }

  const r2Buckets = Array.isArray(config.r2_buckets) ? config.r2_buckets : [];
  for (const bucket of r2Buckets) {
    if (!bucket?.binding || !bucket.bucket_name || bucket.bucket_name === PLACEHOLDER_R2_BUCKET) continue;
    names.add(bucket.binding);
  }

  return names;
}

function upsertR2Bucket(config, bucket) {
  if (!bucket?.binding || !bucket.bucket_name) return;
  const buckets = Array.isArray(config.r2_buckets) ? config.r2_buckets : [];
  const next = buckets.filter((item) => item?.binding !== bucket.binding);
  next.push(bucket);
  config.r2_buckets = next;
}

function syncR2DisplayVars(config) {
  const buckets = Array.isArray(config.r2_buckets) ? config.r2_buckets : [];
  const mailBucket = buckets.find((item) => item?.binding === "MAIL_BUCKET" && item.bucket_name);
  const extraBuckets = buckets
    .filter((item) => item?.binding && item.bucket_name && !RESERVED_R2_BINDINGS.has(item.binding))
    .map((item) => `${item.binding}:${item.bucket_name}`);

  if (mailBucket) {
    upsertVar(config, "R2_BUCKET_NAME", mailBucket.bucket_name);
  }

  if (extraBuckets.length > 0) {
    upsertVar(config, "EXTRA_R2_BUCKETS", extraBuckets.join(","));
  }
}

function upsertVar(config, name, value) {
  if (!value) return;
  config.vars = isPlainObject(config.vars) ? config.vars : {};
  config.vars[name] = value;
}

async function configuredAccountId(tokenValue) {
  const configured = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  if (configured) return configured;

  const accounts = await cloudflare(tokenValue, "/accounts?per_page=2");
  const results = Array.isArray(accounts.result) ? accounts.result : [];
  if (results.length === 1 && results[0]?.id) {
    return results[0].id;
  }

  if (results.length > 1) {
    console.warn("OmniDock API token can access multiple Cloudflare accounts. Set CLOUDFLARE_ACCOUNT_ID as a build variable to preserve bindings.");
  }

  return null;
}

async function fetchWorkerBindings(tokenValue, accountId, scriptName) {
  const encodedScript = encodeURIComponent(scriptName);
  const response = await cloudflare(
    tokenValue,
    `/accounts/${accountId}/workers/scripts/${encodedScript}/settings`
  );
  return Array.isArray(response.result?.bindings) ? response.result.bindings : [];
}

async function cloudflare(tokenValue, path) {
  const response = await fetch(`${CLOUDFLARE_API}${path}`, {
    headers: {
      authorization: `Bearer ${tokenValue}`,
      accept: "application/json"
    }
  });

  const body = await response.json().catch(() => null);
  if (!response.ok || body?.success === false) {
    const message = body?.errors?.[0]?.message ?? `${response.status} ${response.statusText}`;
    throw new Error(message);
  }
  return body;
}

function readJsonc(path) {
  const source = fs.readFileSync(path, "utf8");
  return JSON.parse(stripJsonComments(source));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stripJsonComments(source) {
  let output = "";
  let inString = false;
  let quote = "";
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        inString = false;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      inString = true;
      quote = char;
      output += char;
      continue;
    }

    if (char === "/" && next === "/") {
      while (index < source.length && source[index] !== "\n") {
        index += 1;
      }
      output += "\n";
      continue;
    }

    if (char === "/" && next === "*") {
      index += 2;
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) {
        index += 1;
      }
      index += 1;
      continue;
    }

    output += char;
  }

  return output;
}

function readError(error) {
  return error instanceof Error ? error.message : String(error);
}

function envValue(name) {
  return process.env[name]?.trim() || "";
}

function envFlag(name) {
  return process.env[name] === "1";
}

function parseExtraR2Buckets(value) {
  if (!value) return [];
  const buckets = [];
  const seen = new Set(["MAIL_BUCKET"]);

  for (const rawItem of value.split(/[,\n]/)) {
    const item = rawItem.trim();
    if (!item) continue;
    const separator = item.includes("=") ? "=" : item.includes(":") ? ":" : "";
    const bucketName = (separator ? item.slice(item.indexOf(separator) + 1) : item).trim();
    const binding = (separator ? item.slice(0, item.indexOf(separator)) : bindingNameForBucket(bucketName)).trim();
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(binding) || !bucketName || seen.has(binding) || RESERVED_R2_BINDINGS.has(binding)) continue;
    seen.add(binding);
    buckets.push({ binding, bucket_name: bucketName });
  }

  return buckets;
}

function bindingNameForBucket(bucketName) {
  const normalized = bucketName
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return `R2_${normalized || "BUCKET"}`;
}
