/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  WELLNESS_ENABLE_LOCAL_AUTH?: string;
  WELLNESS_ALLOWED_EMAILS?: string;
  WELLNESS_DEV_USER_ID?: string;
  WELLNESS_DEV_USER_EMAIL?: string;
  WELLNESS_DEV_USER_NAME?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    let routedRequest = request;
    const localHost = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (
      localHost &&
      env.WELLNESS_ENABLE_LOCAL_AUTH === "true" &&
      env.WELLNESS_DEV_USER_ID &&
      env.WELLNESS_DEV_USER_EMAIL
    ) {
      const requestHeaders = new Headers(request.headers);
      requestHeaders.set("oai-authenticated-user-id", env.WELLNESS_DEV_USER_ID);
      requestHeaders.set("oai-authenticated-user-email", env.WELLNESS_DEV_USER_EMAIL);
      if (env.WELLNESS_DEV_USER_NAME) {
        requestHeaders.set(
          "oai-authenticated-user-full-name",
          encodeURIComponent(env.WELLNESS_DEV_USER_NAME),
        );
        requestHeaders.set(
          "oai-authenticated-user-full-name-encoding",
          "percent-encoded-utf-8",
        );
      }
      routedRequest = new Request(request, { headers: requestHeaders });
    }

    return handler.fetch(routedRequest, env, ctx);
  },
};

export default worker;
