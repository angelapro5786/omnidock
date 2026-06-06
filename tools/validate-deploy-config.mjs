import fs from "node:fs";

const STRICT_FLAG = "EMAILFOX_STRICT_CONFIG_CHECK";
const PLACEHOLDER_D1_ID = "00000000-0000-0000-0000-000000000000";
const PLACEHOLDER_R2_BUCKET = "emailfox-mail";

const config = readJsonc("wrangler.jsonc");
const warnings = [];

const d1 = Array.isArray(config.d1_databases) ? config.d1_databases.find((item) => item.binding === "DB") : null;
if (!d1) {
  warnings.push("DB binding is not in the deploy config. First deploy can continue, but set EMAILFOX_D1_DATABASE_ID before normal Git updates.");
} else if (!d1.database_id || d1.database_id === PLACEHOLDER_D1_ID) {
  warnings.push("DB.database_id is still the public placeholder. Emailfox will remove it unless EMAILFOX_D1_DATABASE_ID is set.");
}

const r2 = Array.isArray(config.r2_buckets) ? config.r2_buckets.find((item) => item.binding === "MAIL_BUCKET") : null;
if (!r2) {
  warnings.push("MAIL_BUCKET binding is not in the deploy config. First deploy can continue, but set EMAILFOX_R2_BUCKET_NAME before normal Git updates.");
} else if (!r2.bucket_name || r2.bucket_name === PLACEHOLDER_R2_BUCKET) {
  warnings.push("MAIL_BUCKET uses the public placeholder bucket name. Emailfox will remove it unless EMAILFOX_R2_BUCKET_NAME is set.");
}

if (warnings.length > 0) {
  const strict = process.env[STRICT_FLAG] === "1";
  const output = strict ? console.error : console.warn;
  output("Emailfox deploy configuration warning:");
  for (const warning of warnings) {
    output(`- ${warning}`);
  }
  output("The Worker will show setup requirements at runtime until DB and MAIL_BUCKET are connected.");
  if (strict) {
    process.exit(1);
  }
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
