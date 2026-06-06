import fs from "node:fs";

const CONFIG_PATH = process.env.EMAILFOX_CONFIG_PATH || "wrangler.jsonc";
const PLACEHOLDER_D1_ID = "00000000-0000-0000-0000-000000000000";

const d1DatabaseId = process.env.EMAILFOX_D1_DATABASE_ID?.trim();
const d1DatabaseName = process.env.EMAILFOX_D1_DATABASE_NAME?.trim() || "emailfox-db";
const r2BucketName = process.env.EMAILFOX_R2_BUCKET_NAME?.trim();
const allowUnboundDeploy = process.env.EMAILFOX_ALLOW_UNBOUND_DEPLOY === "1";

const config = readJsonc(CONFIG_PATH);
let changed = false;

if (allowUnboundDeploy && !d1DatabaseId && !r2BucketName) {
  delete config.d1_databases;
  delete config.r2_buckets;
  changed = true;
  console.warn("Emailfox removed DB/R2 placeholders for an intentional unbound first deploy.");
} else if (d1DatabaseId && d1DatabaseId !== PLACEHOLDER_D1_ID) {
  config.d1_databases = [
    {
      binding: "DB",
      database_name: d1DatabaseName,
      database_id: d1DatabaseId,
      migrations_dir: "migrations"
    }
  ];
  changed = true;
}

if (r2BucketName) {
  config.r2_buckets = [
    {
      binding: "MAIL_BUCKET",
      bucket_name: r2BucketName
    }
  ];
  changed = true;
}

if (changed) {
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);
  console.log(`Emailfox prepared ${CONFIG_PATH} for this build.`);
}

function readJsonc(path) {
  const source = fs.readFileSync(path, "utf8");
  return JSON.parse(stripJsonComments(source));
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
