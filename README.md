# EmailFox

Emailfox is a private, multi-domain email management panel for Cloudflare Workers, Cloudflare Email Sending, Cloudflare Email Routing, D1, and R2.

It gives you a compact Linux-style webmail/support inbox for domains in your own Cloudflare account:

- Receive routed email in a Cloudflare Worker `email()` handler
- Store thread metadata in D1
- Store raw MIME messages and attachments in R2
- Send replies through Cloudflare Email Sending
- Sync Cloudflare zones, Email Sending status, and Email Routing status
- Create mailbox addresses and Worker routing rules from the UI
- Import contacts manually or from CSV/TXT/VCF files into D1
- Manage mailbox-specific signatures
- Send outbound attachments while storing copies in R2
- Browse, preview, upload, download, and delete files in the configured R2 bucket
- Choose between five UI palettes: Linux, Ubuntu, Fedora, Plasma, Graphite

Emailfox is not an IMAP/POP3 server and does not replace a full mailbox provider. It is best for private support inboxes, project inboxes, catch-all workflows, and lightweight multi-domain email operations that already live on Cloudflare.

## Screenshots

The default Linux palette is compact and terminal-like, with mailbox selection, inbox/sent/archive folders, Cloudflare sync, and compose controls on one screen.

![Emailfox Linux inbox](docs/screenshots/emailfox-inbox-linux.png)

Domain routing, catch-all, mailbox rules, contacts, and signatures live under Settings so the inbox stays focused.

![Emailfox rules and domain settings](docs/screenshots/emailfox-rules-linux.png)

## Fork-First Deploy

Do not deploy Emailfox directly from the upstream repository. Fork it first, then deploy your own fork. That gives you a repository you control and makes future updates safer.

Recommended install flow:

1. Click `Fork` on GitHub and create your own copy of this repository.
2. Open Cloudflare Workers & Pages.
3. Create a D1 database and an R2 bucket for Emailfox.
4. Create a Worker from Git and select your fork.
5. In `Settings > Build > Build configuration`, add the build variables listed below.
6. Set the deploy command so Emailfox can preserve D1/R2 bindings.
7. Add the runtime variables and secrets listed below in Worker settings.
8. Open the Worker URL and finish setup inside the app.

Do not rely on dashboard-added D1/R2 bindings alone. Wrangler treats the deploy configuration as the source of truth, so a Git deploy can remove dashboard bindings when the deploy config does not include them.

## Updating an Existing Install

For updates, use your fork. Pull or merge Emailfox upstream updates into that fork, keep your Worker bindings and secrets in Cloudflare, then let Workers Builds run the commands below.

The deploy script can preserve existing bindings from Cloudflare when `CLOUDFLARE_API_TOKEN` is available to the build command. The safest path is still to keep the deploy variables below set on every Git deploy:

```bash
npm run build && node tools/deploy-preserving-bindings.mjs
```

Wrangler treats its config file as the source of truth. A plain `wrangler deploy` can remove dashboard-added D1/R2 bindings if they are not present in the deploy config. Emailfox adds `DB` and `MAIL_BUCKET` during build from `EMAILFOX_D1_DATABASE_ID` and `EMAILFOX_R2_BUCKET_NAME`, and uses `tools/deploy-preserving-bindings.mjs` for local deploys. If it cannot preserve both `DB` and `MAIL_BUCKET` on an existing Worker, the local deploy helper stops before Wrangler can remove them.

In Cloudflare Workers Builds, do not use a bare deploy command of `npx wrangler deploy` for Emailfox updates. Use one of these:

| Cloudflare field | Recommended value |
| --- | --- |
| Build command | `npm run build` |
| Deploy command | `node tools/deploy-preserving-bindings.mjs` |

Alternative: leave the Build command empty and set Deploy command to `npm run deploy`.

## 0. Prepare Cloudflare First

Before deploying Emailfox, prepare these items.

### Cloudflare Account

You need a Cloudflare account with Workers enabled and at least one domain managed by Cloudflare if you want production email routing.

### Domain

Add your domain to Cloudflare and make sure the zone is active.

Examples:

- `example.com`
- `company.com`
- `support.example.com`

### Email Sending

Enable Cloudflare Email Sending for every domain or subdomain you want to send from.

Emailfox can only send from a domain marked as verified by Cloudflare and synced into D1.

### Email Routing

Enable Cloudflare Email Routing for every receiving domain.

For inbound mail, you will later choose one of these routing modes in Emailfox:

- Mailbox rule: route one address such as `support@example.com` to the Worker.
- Catch-all: route all unmatched addresses for the domain to the Worker.

Mailbox rules are safer for most setups. Catch-all is powerful, but it also receives misspelled and unknown addresses.

### First Admin Account

After the first deploy, add the required runtime values: `ADMIN_PASSWORD` as a secret, `PRIMARY_DOMAIN` as a plaintext variable, and `CLOUDFLARE_API_TOKEN` as a secret. If no admin account exists, Emailfox shows the setup screen and asks for:

- Name
- Email
- Recovery email, required and outside the primary domain
- Primary domain
- Admin password, which must match the `ADMIN_PASSWORD` secret

The recovery email is the password reset recipient. Use an external address such as a Gmail, iCloud, Outlook, or company mailbox that is not under the primary Emailfox domain.

The first password is read from the `ADMIN_PASSWORD` Worker secret, verified once on the setup screen, and then stored as a salted PBKDF2 hash in D1.

### Cloudflare Automation Token

Emailfox requires `CLOUDFLARE_API_TOKEN` before first setup so it can verify Cloudflare inventory, Email Routing status, Email Sending status, catch-all setup, and mailbox routing rule creation.

Recommended permissions:

- Account > Account > Read
- Account > Email Sending > Read
- Zone > Zone > Read
- Zone > Email Routing > Read
- Zone > Email Routing > Edit
- Account > Workers Scripts > Read

If your token can access exactly one Cloudflare account, Emailfox detects that account automatically. If it can access multiple accounts, add `CLOUDFLARE_ACCOUNT_ID` as a plaintext variable too.

## Cloudflare Build Variables

Add these in the screen shown under:

`Worker > Settings > Build > Build configuration > Variables and secrets`

These values are build-time only. They are used so Wrangler deploys the Worker with the correct resource bindings. They are not runtime secrets for the app UI.

| Name | Value to type | Required |
| --- | --- | --- |
| `EMAILFOX_D1_DATABASE_ID` | Your D1 database id | Yes |
| `EMAILFOX_R2_BUCKET_NAME` | Your R2 bucket name, for example `emailfox-mail` | Yes |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account id | Only if the build token can access multiple accounts |

You normally do not need to set `EMAILFOX_D1_DATABASE_NAME`. Wrangler's D1 binding format needs a `database_name`, but Emailfox fills it as `emailfox-db` automatically. Set `EMAILFOX_D1_DATABASE_NAME` only if you want the generated deploy config to show a different D1 display name.

If these are missing, a deploy can disconnect `DB` or `MAIL_BUCKET`. Add them before first real deploy and keep them for every Git update.

## Runtime Variables And Secrets

After deploy, open:

`Worker > Settings > Variables and Secrets > Add`

Add Emailfox runtime settings in that Cloudflare screen. This is a different screen from Build configuration. Use `Secret` only for sensitive values. Use plaintext variables for non-sensitive routing and display values.

Cloudflare does not create empty rows from the repository. Add one row for each value you need: choose the `Type`, paste the exact value from `Name` into the Cloudflare `Name` field, type your own value into `Value`, then save.

| Type | Name | Value to type | When to add |
| --- | --- | --- | --- |
| Secret | `ADMIN_PASSWORD` | First admin password, at least 12 characters | Required before first setup |
| Plaintext variable | `PRIMARY_DOMAIN` | Your first email domain, for example `example.com` | Required before first setup |
| Secret | `CLOUDFLARE_API_TOKEN` | Cloudflare API token | Required before first setup |
| Plaintext variable | `R2_BUCKET_NAME` | R2 bucket display name, for example `emailfox-mail` | Optional, shown in the Buckets sidebar |
| Plaintext variable | `WORKER_SCRIPT_NAME` | Deployed Worker script name, for example `emailfox` | Add when you want Emailfox to create Email Routing rules |
| Plaintext variable | `MANAGEMENT_HOST` | Custom dashboard hostname, for example `mail.example.com` | Add only for a custom dashboard hostname |
| Plaintext variable | `PASSWORD_RESET_FROM` | Verified reset sender, for example `no-reply@example.com` | Add only for a custom verified reset sender |
| Plaintext variable | `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account id | Add only if one token can access multiple Cloudflare accounts |

`PRIMARY_DOMAIN` is not a secret. It is fine as a plaintext variable. Do not add `ADMIN_PASSWORD` or `CLOUDFLARE_API_TOKEN` as plaintext variables.

D1 and R2 are not secrets. Add them as Cloudflare bindings/resources:

| Binding name | Resource |
| --- | --- |
| `DB` | D1 database |
| `MAIL_BUCKET` | R2 bucket |
| `EMAIL` | Cloudflare Email Sending binding |

Bindings cannot be replaced by Worker secrets. The running Worker must receive `DB` as a D1 binding and `MAIL_BUCKET` as an R2 binding. `R2_BUCKET_NAME` is only a display variable for the Buckets UI; it does not grant access by itself.

The deploy script runs:

```bash
npm run build && node tools/deploy-preserving-bindings.mjs
```

`npm run build` runs `tools/prepare-deploy-config.mjs` before TypeScript and Vite. That script writes the real deploy bindings into the build copy of `wrangler.jsonc` when the deploy variables are present.

Emailfox performs a defensive schema check during setup and inbound email handling. When the `DB` binding exists, the Worker can complete the current schema on that binding and mark the bundled migrations as applied. It does not create a new D1 database.

For binding-safe deploys, make `CLOUDFLARE_API_TOKEN` available to the build/deploy command too. If the token can access multiple accounts, also set `CLOUDFLARE_ACCOUNT_ID`. Private installs may alternatively set `EMAILFOX_D1_DATABASE_ID` and `EMAILFOX_R2_BUCKET_NAME` as build variables.

If the Cloudflare Git deploy screen asks for commands, use:

- Build command: `npm run build`
- Deploy command: `node tools/deploy-preserving-bindings.mjs`

If you prefer one command only, leave Build command empty and use Deploy command: `npm run deploy`.

## First Login

After deploy:

1. Open the Worker URL shown by Cloudflare.
2. If Emailfox lists missing setup, add those binding/secret names in Cloudflare Worker settings.
3. Complete the setup screen with name, email, recovery email, and primary domain.
4. Log in with the `ADMIN_PASSWORD` secret value.
5. Create mailboxes such as `support`, `info`, or `billing`.
6. Use `Settings > Rules` to route addresses to the Worker.
7. Click `Sync Cloudflare` to refresh Cloudflare inventory and routing checks.

## Custom Domain

The public template intentionally does not include a personal custom domain in `wrangler.jsonc`.

To use your own management host, add a custom domain in Cloudflare Workers, then set:

```bash
npx wrangler secret put MANAGEMENT_HOST
```

You can also keep `MANAGEMENT_HOST` blank and use the generated `workers.dev` URL.

## Manual Install

Use this path if you deploy from your own machine instead of Cloudflare Git deploy.

Install dependencies:

```bash
npm install
```

Create D1 and R2:

```bash
npx wrangler d1 create emailfox-db
npx wrangler r2 bucket create emailfox-mail
```

For a dashboard-managed install, add these resources in Cloudflare and keep the deploy variables set so updates do not remove them:

- `DB` -> the D1 database
- `MAIL_BUCKET` -> the R2 bucket
- `EMAIL` -> Cloudflare Email Sending

For a private Wrangler-managed install, add your own D1 `database_id` and R2 `bucket_name` to your private fork's `wrangler.jsonc`:

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "emailfox-db",
    "database_id": "your-d1-database-id"
  }
],
"r2_buckets": [
  {
    "binding": "MAIL_BUCKET",
    "bucket_name": "emailfox-mail"
  }
]
```

Build and deploy:

```bash
npm run deploy
```

If your private `wrangler.jsonc` contains the `DB` binding and you want to run migrations explicitly before deploy, use:

```bash
npm run deploy:with-migrations
```

Then set Emailfox runtime settings in Cloudflare:

`Worker > Settings > Variables and Secrets > Add`

Wrangler secret equivalent:

```bash
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put CLOUDFLARE_API_TOKEN
```

Set plaintext variables such as `PRIMARY_DOMAIN`, `WORKER_SCRIPT_NAME`, `MANAGEMENT_HOST`, `PASSWORD_RESET_FROM`, and `CLOUDFLARE_ACCOUNT_ID` in the Cloudflare dashboard. For private installs only, you may keep plaintext values under `vars` in your private `wrangler.jsonc`; do not commit personal values to a public fork.

Set `ADMIN_PASSWORD`, `PRIMARY_DOMAIN`, and `CLOUDFLARE_API_TOKEN` before first setup. Only set the optional plaintext variables you need.

## Local Development

Create `.dev.vars` only if you need local-only secret values:

```bash
touch .dev.vars
```

Edit `.dev.vars` only if you want local secrets. Do not commit it.

```dotenv
# optional local secrets go here
# ADMIN_PASSWORD=
# CLOUDFLARE_API_TOKEN=

# optional local plaintext variables go here
# PRIMARY_DOMAIN=
```

Optional local-only values:

```dotenv
PASSWORD_RESET_FROM=no-reply@example.com
```

If you want local sample data, add this only to your local `.dev.vars`:

```dotenv
ENABLE_DEV_SEED=true
```

Run the Worker API:

```bash
npm run dev:worker
```

Run the Vite UI:

```bash
npm run dev
```

Vite proxies `/api` to `http://127.0.0.1:8787`.

For local sample data after migrations:

```bash
curl -X POST http://127.0.0.1:8787/api/dev/seed \
  -H "Authorization: Bearer $EMAILFOX_PASSWORD" \
  -H "Content-Type: application/json" \
  -d "{}"
```

The seed endpoint is disabled unless `ENABLE_DEV_SEED=true`.

## Architecture

| Layer | Technology |
| --- | --- |
| UI | React + Vite |
| Runtime | Cloudflare Workers |
| Static assets | Workers assets binding |
| Inbound email | Cloudflare Email Routing to Worker `email()` handler |
| Outbound email | Cloudflare Email Sending binding |
| Metadata | Cloudflare D1 |
| Raw mail/attachments | Cloudflare R2 |
| Admin auth | D1-stored salted PBKDF2 password hash |

## Security Notes

- Do not commit `.dev.vars`.
- Do not commit real API tokens or admin passwords.
- Use least-privilege Cloudflare API tokens.
- Password reset tokens are stored hashed in D1 and expire after 30 minutes.
- Emailfox only sends from enabled D1 mailbox addresses on verified sending domains.
- `sessionStorage` is used for the admin password in the browser session. For a larger public SaaS deployment, consider replacing this with HttpOnly session cookies and CSRF protection.
- The default public template has no custom domain, account id, D1 id, or personal domain baked into source control.

## Useful Commands

```bash
npm run types
npm run check
npm run build
npm run deploy
npm run db:migrate:local
npm run db:migrate:remote
```

## Public Repository Checklist

Before making your repository public:

- Confirm `wrangler.jsonc` does not contain your personal account id, D1 id, or custom domain.
- Confirm `.dev.vars` is not tracked.
- Confirm docs/screenshots do not show private domains or real emails.
- Confirm the README uses the fork-first install flow and does not include a one-click deploy button.
- Run `npm audit --audit-level=moderate`.
- Run `npm run build`.

## License

Choose and add a license before announcing the repository publicly. MIT is a common choice for small developer tools, but pick the license that matches how you want others to use Emailfox.
