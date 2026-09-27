import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";

import { DEFAULT_MCP_URL } from "./config.ts";
import type { InputRecord, McpResult, McpTool } from "./types.ts";

interface ClientOptions {
  url: string;
  version: string;
  token?: string;
  fetchImpl?: typeof fetch;
  authStorePath?: string;
}

interface ServerAuth {
  state?: string;
  clientInformation?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  codeVerifier?: string;
}

// Credentials are keyed by MCP server URL so a token issued for Linear is never sent to a
// different endpoint configured through LINEAR_AXI_MCP_URL or Codex config.
interface OAuthStore extends ServerAuth {
  servers?: Record<string, ServerAuth>;
}

export class LinearMcpClient {
  url: string;
  version: string;
  token?: string;
  fetchImpl?: typeof fetch;
  authStorePath?: string;
  authProvider: LinearOAuthProvider | null;
  client: Client | null = null;
  transport: StreamableHTTPClientTransport | null = null;

  constructor({ url, version, token, fetchImpl, authStorePath }: ClientOptions) {
    this.url = url;
    this.version = version;
    this.token = token;
    this.fetchImpl = fetchImpl;
    this.authStorePath = authStorePath;
    this.authProvider = token
      ? null
      : new LinearOAuthProvider({ storePath: authStorePath, serverUrl: url });
  }

  async connect(): Promise<void> {
    this.transport = new StreamableHTTPClientTransport(new URL(this.url), {
      requestInit: this.token ? { headers: { authorization: `Bearer ${this.token}` } } : undefined,
      authProvider: this.authProvider ?? undefined,
      fetch: this.fetchImpl,
    });
    this.client = new Client({ name: "linear-axi", version: this.version });
    try {
      await this.client.connect(this.transport);
    } catch (error) {
      if (this.authProvider?.authorizationUrl) {
        throw Object.assign(new Error("Linear MCP OAuth authorization required"), {
          authorizationUrl: this.authProvider.authorizationUrl,
        });
      }
      throw error;
    }
  }

  async listTools(): Promise<McpTool[]> {
    await this.ensureConnected();
    return (await this.client!.listTools()).tools ?? [];
  }

  async callTool(name: string, args: InputRecord): Promise<McpResult> {
    await this.ensureConnected();
    return (await this.client!.callTool({ name, arguments: args })) as McpResult;
  }

  async finishAuth(code: string): Promise<void> {
    this.transport = new StreamableHTTPClientTransport(new URL(this.url), {
      authProvider: this.authProvider ?? undefined,
      fetch: this.fetchImpl,
    });
    await this.transport.finishAuth(code);
  }

  async logoutAuth(): Promise<{ removed: boolean; tokenConfigured: boolean }> {
    const provider =
      this.authProvider ??
      new LinearOAuthProvider({ storePath: this.authStorePath, serverUrl: this.url });
    return { removed: await provider.deleteStore(), tokenConfigured: Boolean(this.token) };
  }

  async close(): Promise<void> {
    await this.transport?.close();
  }

  async ensureConnected(): Promise<void> {
    if (!this.client) await this.connect();
  }
}

export class LinearOAuthProvider implements OAuthClientProvider {
  storePath: string;
  serverUrl: string;
  authorizationUrl: string | null = null;

  constructor({ storePath, serverUrl }: { storePath?: string; serverUrl?: string } = {}) {
    this.storePath = storePath ?? defaultAuthStorePath();
    this.serverUrl = serverUrl ?? DEFAULT_MCP_URL;
  }

  get redirectUrl(): string {
    return "http://127.0.0.1:14566/oauth/callback";
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "linear-axi",
      redirect_uris: [this.redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "client_secret_post",
    };
  }

  async state(): Promise<string> {
    const auth = await this.readServerAuth();
    if (auth.state) return auth.state;
    const state = randomBytes(24).toString("base64url");
    await this.updateServerAuth({ state });
    return state;
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    return (await this.readServerAuth()).clientInformation;
  }

  async saveClientInformation(value: OAuthClientInformationMixed): Promise<void> {
    await this.updateServerAuth({ clientInformation: value });
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    return (await this.readServerAuth()).tokens;
  }

  async saveTokens(value: OAuthTokens): Promise<void> {
    await this.updateServerAuth({ tokens: value });
  }

  async redirectToAuthorization(url: URL): Promise<void> {
    this.authorizationUrl = url.toString();
  }

  async saveCodeVerifier(value: string): Promise<void> {
    await this.updateServerAuth({ codeVerifier: value });
  }

  async codeVerifier(): Promise<string> {
    const value = (await this.readServerAuth()).codeVerifier;
    if (!value) throw new Error("No OAuth code verifier saved");
    return value;
  }

  async invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier"): Promise<void> {
    const auth = await this.readServerAuth();
    if (scope === "all" || scope === "client") delete auth.clientInformation;
    if (scope === "all" || scope === "tokens") delete auth.tokens;
    if (scope === "all" || scope === "verifier") {
      delete auth.codeVerifier;
      delete auth.state;
    }
    await this.writeServerAuth(auth);
  }

  // Removes only this server's credentials; the file goes away once no server entries remain.
  async deleteStore(): Promise<boolean> {
    const servers = serverEntries(await this.readStore());
    const removed = Object.keys(servers[this.serverUrl] ?? {}).length > 0;
    delete servers[this.serverUrl];
    if (Object.keys(servers).length > 0) {
      await this.writeStore({ servers });
      return removed;
    }
    try {
      await rm(this.storePath);
      return removed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }

  async readServerAuth(): Promise<ServerAuth> {
    return { ...serverEntries(await this.readStore())[this.serverUrl] };
  }

  async updateServerAuth(patch: ServerAuth): Promise<void> {
    await this.writeServerAuth({ ...(await this.readServerAuth()), ...patch });
  }

  async writeServerAuth(auth: ServerAuth): Promise<void> {
    const servers = serverEntries(await this.readStore());
    servers[this.serverUrl] = auth;
    await this.writeStore({ servers });
  }

  async readStore(): Promise<OAuthStore> {
    try {
      return JSON.parse(await readFile(this.storePath, "utf8"));
    } catch {
      return {};
    }
  }

  async writeStore(store: OAuthStore): Promise<void> {
    await mkdir(dirname(this.storePath), { recursive: true });
    await writeFile(this.storePath, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
    await chmod(this.storePath, 0o600);
  }
}

// Stores written before credentials were keyed by URL only ever held default-endpoint logins,
// so their top-level fields migrate to the default Linear MCP URL.
function serverEntries(store: OAuthStore): Record<string, ServerAuth> {
  const { servers, ...legacy } = store;
  const entries = { ...servers };
  if (Object.keys(legacy).length > 0 && !entries[DEFAULT_MCP_URL]) {
    entries[DEFAULT_MCP_URL] = legacy;
  }
  return entries;
}

function defaultAuthStorePath(): string {
  return join(
    process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
    "linear-axi",
    "oauth.json",
  );
}
