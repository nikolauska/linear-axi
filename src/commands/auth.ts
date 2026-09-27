import { createServer } from "node:http";
import { parseFlags, usage } from "../args.ts";
import { dispatchCommandGroup } from "../lib/cli-helpers.ts";
import { authFinishHelp, authLoginHelp, authLogoutHelp, groupHelp } from "./help.ts";

export async function authCommand(args, runtime) {
  return dispatchCommandGroup(args, {
    name: "auth",
    help: () => groupHelp("auth", ["login", "finish", "logout"]),
    handlers: {
      login: (rest) => loginCommand(rest, runtime),
      finish: (rest) => finishCommand(rest, runtime),
      logout: (rest) => logoutCommand(rest, runtime),
    },
    unknownHelp: [
      "Run `linear-axi auth login`",
      "Run `linear-axi auth finish --code <code>`",
      "Run `linear-axi auth logout`",
    ],
  });
}

async function loginCommand(args, runtime) {
  const parsed = parseFlags(args, {
    command: "auth login",
    value: ["timeout"],
    boolean: ["manual"],
  });
  if (parsed.help) return authLoginHelp();
  const timeoutMs = Number(parsed.timeout ?? 300000);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw usage("--timeout must be a positive number of milliseconds", [
      "Run `linear-axi auth login --help`",
    ]);
  }
  try {
    await runtime.client.listTools();
    return { auth: "Linear MCP OAuth already authorized" };
  } catch (error) {
    const authorizationUrl = authUrl(error);
    if (authorizationUrl) {
      if (parsed.manual) {
        return {
          auth: "Linear MCP OAuth authorization required",
          url: authorizationUrl,
          help: ["Open the URL, copy the code, then run `linear-axi auth finish --code <code>`"],
        };
      }

      return completeLoginWithCallback(authorizationUrl, runtime, timeoutMs);
    }
    throw error;
  }
}

async function finishCommand(args, runtime) {
  const parsed = parseFlags(args, { command: "auth finish", value: ["code"] });
  if (parsed.help) return authFinishHelp();
  if (!parsed.code)
    throw usage("--code is required", ["Run `linear-axi auth finish --code <code>`"]);
  await runtime.client.finishAuth(parsed.code);
  return { auth: "Linear MCP OAuth authorized" };
}

async function logoutCommand(args, runtime) {
  const parsed = parseFlags(args, { command: "auth logout" });
  if (parsed.help) return authLogoutHelp();
  const result = await runtime.client.logoutAuth();
  const auth = result.removed
    ? "Linear MCP OAuth credentials cleared"
    : "Linear MCP OAuth credentials already absent";
  return {
    auth,
    ...(result.tokenConfigured
      ? { note: "LINEAR_AXI_MCP_TOKEN or LINEAR_MCP_TOKEN remains configured" }
      : {}),
  };
}

async function completeLoginWithCallback(authorizationUrl, runtime, timeoutMs) {
  const callbackUrl = new URL("http://127.0.0.1:14566/oauth/callback");
  const expectedState = new URL(authorizationUrl).searchParams.get("state");
  if (!expectedState) {
    throw usage("OAuth authorization URL did not include state", [
      "Run `linear-axi auth login --manual`",
    ]);
  }
  const server = await startOAuthCallbackServer(callbackUrl, timeoutMs, expectedState);

  // stdout carries only the final result; the URL is progress the user needs while waiting.
  runtime.stderr?.write?.(
    [
      "Open this URL in a browser to authorize linear-axi:",
      authorizationUrl,
      `Waiting for the callback on ${callbackUrl} (rerun with --manual if it cannot reach this machine)`,
      "",
    ].join("\n"),
  );

  try {
    const code = await server.code;
    await runtime.client.finishAuth(code);
    return { auth: "Linear MCP OAuth authorized" };
  } finally {
    await server.close();
  }
}

async function startOAuthCallbackServer(callbackUrl, timeoutMs, expectedState) {
  if (callbackUrl.hostname !== "127.0.0.1" && callbackUrl.hostname !== "localhost") {
    throw usage("OAuth callback must use localhost or 127.0.0.1", [
      "Run `linear-axi auth login --manual`",
    ]);
  }

  let timeout;
  let settled = false;
  let resolveCode;
  let rejectCode;
  const code = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });

  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", callbackUrl.origin);
    if (requestUrl.pathname !== callbackUrl.pathname) {
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("Not found.\n");
      return;
    }

    const error = requestUrl.searchParams.get("error");
    const authCode = requestUrl.searchParams.get("code");
    const state = requestUrl.searchParams.get("state");
    if (state !== expectedState) {
      response.writeHead(400, { "content-type": "text/plain" });
      response.end("OAuth state did not match. You can close this tab.\n");
      return;
    }
    if (error) {
      response.writeHead(400, { "content-type": "text/plain" });
      response.end("Linear authorization failed. You can close this tab.\n");
      finish(new Error(`Linear OAuth error: ${error}`), undefined);
      return;
    }
    if (!authCode) {
      response.writeHead(400, { "content-type": "text/plain" });
      response.end("Missing OAuth code. You can close this tab.\n");
      finish(new Error("Linear OAuth callback did not include a code"), undefined);
      return;
    }

    response.writeHead(200, { "content-type": "text/plain" });
    response.end("Linear authorization captured. You can close this tab.\n");
    finish(null, authCode);
  });

  function finish(error: Error | null, authCode?: string) {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    if (error) rejectCode(error);
    else resolveCode(authCode as string);
  }

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(Number(callbackUrl.port || 80), callbackUrl.hostname, () => resolve());
  });

  timeout = setTimeout(() => {
    finish(new Error("Timed out waiting for Linear OAuth callback"), undefined);
  }, timeoutMs);

  return {
    code,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function authUrl(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("authorizationUrl" in error)) return null;
  return typeof error.authorizationUrl === "string" ? error.authorizationUrl : null;
}
