import { httpActionGeneric } from "convex/server";
import type { ComponentApi } from "../component/_generated/component.js";
import { createRemoteJWKSet, jwtVerify } from "jose";

export type KindeSyncOptions = {
  /** Your Kinde issuer URL e.g. https://yourapp.kinde.com */
  KINDE_ISSUER_URL: string;
};

/** Build a JSON response with the standard Content-Type header. */
function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export class KindeSync {
  webhookHandler: ReturnType<typeof httpActionGeneric>;

  constructor(
    public component: ComponentApi,
    private options: KindeSyncOptions,
  ) {
    const domain = options.KINDE_ISSUER_URL;
    const component_ = component;

    // Validate the issuer before building any URL, so a missing config throws a
    // clear error instead of producing "undefined/.well-known/jwks.json" and
    // crashing module analysis at deploy time.
    if (!domain) {
      throw new Error(
        "KindeSync: KINDE_ISSUER_URL is required to construct the client",
      );
    }

    // Create the JWKS client once, keyed by the (validated) issuer domain, so
    // jose's built-in key cache is reused across requests instead of being
    // rebuilt (and refetched) on every webhook.
    const JWKS: ReturnType<typeof createRemoteJWKSet> = createRemoteJWKSet(
      new URL(`${domain}/.well-known/jwks.json`),
    );

    this.webhookHandler = httpActionGeneric(async (ctx, request) => {
      const token = await request.text();
      if (!token) {
        return jsonResponse(400, { error: "Missing token" });
      }

      let payload: Record<string, unknown>;
      try {
        // Bind verification to the tenant by asserting the issuer matches the
        // domain we fetched the JWKS from.
        const result = await jwtVerify(token, JWKS, { issuer: domain });
        payload = result.payload as Record<string, unknown>;
      } catch (err) {
        console.error("Kinde webhook JWT verification failed:", err);
        return jsonResponse(401, { error: "Invalid token" });
      }

      // Kinde webhooks are JWTs and always carry a `jti`, so this rejection is
      // only for genuinely malformed payloads. There is deliberately no
      // Date.now() fallback: an event with neither `jti` nor `event_id` cannot
      // be deduplicated, and minting a fresh id per retry would make every
      // retry look new and defeat idempotency — so we refuse to process it.
      const jti = payload["jti"];
      const eventId = payload["event_id"];
      let webhookId: string;
      if (typeof jti === "string" && jti) {
        webhookId = jti;
      } else if (typeof eventId === "string" && eventId) {
        webhookId = eventId;
      } else if (typeof eventId === "number") {
        webhookId = `${eventId}`;
      } else {
        return jsonResponse(400, { error: "Missing webhook identifier" });
      }

      const eventType = payload["type"] as string;
      const data = payload["data"] as Record<string, unknown>;
      const user = data?.["user"] as Record<string, unknown> | undefined;

      if (!eventType || !user) {
        return jsonResponse(400, { error: "Invalid payload" });
      }

      const kindeId = (user["id"] as string) ?? "";
      const email = (user["email"] as string) ?? "";
      // Every event is keyed by id, so it is always required.
      if (!kindeId) {
        return jsonResponse(400, { error: "Missing user id" });
      }
      // A delete only needs the id; create/update write the email, so it must
      // be present for those to avoid blank-keyed records.
      if (eventType !== "user.deleted" && !email) {
        return jsonResponse(400, { error: "Missing user email" });
      }

      const organizations = ((user["organizations"] as unknown[]) ?? []).map(
        (org) => {
          const o = org as Record<string, unknown>;
          const permissions = o["permissions"];
          return {
            code: (o["code"] as string) ?? "",
            roles: (o["roles"] as string) || undefined,
            permissions:
              typeof permissions === "string" ? permissions : undefined,
          };
        },
      );

      await ctx.runMutation(component_.lib.handleWebhookEvent, {
        webhookId,
        type: eventType,
        kindeId,
        email,
        firstName: (user["first_name"] as string) || undefined,
        lastName: (user["last_name"] as string) || undefined,
        imageUrl: (user["image_url"] as string) || undefined,
        isSuspended: (user["is_suspended"] as boolean) ?? false,
        organizations,
      });

      return jsonResponse(200, { success: true });
    });
  }
}

export type { ComponentApi };
