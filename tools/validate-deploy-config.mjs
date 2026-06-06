import fs from "node:fs";

const STRICT_FLAG = "EMAILFOX_STRICT_CONFIG_CHECK";
const PLACEHOLDER_D1_ID = "00000000-0000-0000-0000-000000000000";

const config = readJsonc("wrangler.jsonc");
const warnings = [];

const d1 = Array.isArray(config.d1_databases) ? config.d1_databases.find((item) => item.binding === "DB") : null;
if (d1 && (!d1.database_id || d1.database_id === PLACEHOLDER_D1_ID)) {
  warnings.push("DB.database_id is a placeholder. Remove the binding from the public template or replace it in your private fork.");
}

const r2 = Array.isArray(config.r2_buckets) ? config.r2_buckets.find((item) => item.binding === "MAIL_BUCKET") : null;
if (r2 && !r2.bucket_name) {
  warnings.push("MAIL_BUCKET has no bucket_name. Remove the binding from the public template or replace it in your private fork.");
}

if (warnings.length > 0) {
  const strict = process.env[STRICT_FLAG] === "1";
  const output = strict ? console.error : console.warn;
  output("Emailfox deploy configuration warning:");
  for (const warning of warnings) {
    output(`- ${warning}`);
  }
  output("The Worker can still deploy; the app will show missing runtime bindings/secrets on first open.");
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
