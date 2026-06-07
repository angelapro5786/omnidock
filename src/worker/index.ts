import { handleApi } from "./api";
import { receiveEmail } from "./email";
import { EXTERNAL_SYNC_MAX_RUN_MS, runExternalSyncJobs } from "./external-sync";
import { RuntimeEnv, json, withSecurityHeaders } from "./http";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const runtimeEnv = env as RuntimeEnv;
    const url = new URL(request.url);
    const managementHost = runtimeEnv.MANAGEMENT_HOST?.trim();
    const isLocal =
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname.endsWith(".workers.dev");

    if (managementHost && !isLocal && url.hostname !== managementHost) {
      url.hostname = managementHost;
      url.protocol = "https:";
      return withSecurityHeaders(Response.redirect(url.toString(), 308));
    }

    if (url.pathname.startsWith("/api/")) {
      return withSecurityHeaders(await handleApi(request, runtimeEnv, ctx));
    }

    return withSecurityHeaders(await runtimeEnv.ASSETS.fetch(request));
  },

  async email(message: ForwardableEmailMessage, env: Env): Promise<void> {
    const runtimeEnv = env as RuntimeEnv;
    try {
      await receiveEmail(message, runtimeEnv);
    } catch (error) {
      console.error("Failed to receive email", error);
      message.setReject("OmniDock could not accept this message");
    }
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const runtimeEnv = env as RuntimeEnv;
    ctx.waitUntil(
      runExternalSyncJobs(runtimeEnv, { maxDurationMs: EXTERNAL_SYNC_MAX_RUN_MS }).catch((error) => {
        console.error("Failed to run external sync jobs", error);
      })
    );
  }
} satisfies ExportedHandler<Env>;

export function notFound(): Response {
  return json({ ok: false, error: { code: "not_found", message: "Not found" } }, { status: 404 });
}
