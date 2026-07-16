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

import type { InputRecord, McpResult, McpTool } from "./types.ts";

interface ClientOptions {
  url: string;
  token?: string;
  fetchImpl?: typeof fetch;
  authStorePath?: string;
}

interface OAuthStore {
  state?: string;
  clientInformation?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  codeVerifier?: string;
}

export class LinearMcpClient {
  url: string;
  token?: string;
  fetchImpl?: typeof fetch;
  authStorePath?: string;
  authProvider: LinearOAuthProvider | null;
  client: Client | null = null;
  transport: StreamableHTTPClientTransport | null = null;

  constructor({ url, token, fetchImpl, authStorePath }: ClientOptions) {
    this.url = url;
    this.token = token;
    this.fetchImpl = fetchImpl;
    this.authStorePath = authStorePath;
    this.authProvider = token ? null : new LinearOAuthProvider({ storePath: authStorePath });
  }

  async connect(): Promise<void> {
    this.transport = new StreamableHTTPClientTransport(new URL(this.url), {
      requestInit: this.token ? { headers: { authorization: `Bearer ${this.token}` } } : undefined,
      authProvider: this.authProvider ?? undefined,
      fetch: this.fetchImpl,
    });
    this.client = new Client({ name: "linear-axi", version: "0.1.0" });
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
      this.authProvider ?? new LinearOAuthProvider({ storePath: this.authStorePath });
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
  authorizationUrl: string | null = null;

  constructor({ storePath }: { storePath?: string } = {}) {
    this.storePath = storePath ?? defaultAuthStorePath();
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
    const store = await this.readStore();
    if (store.state) return store.state;
    const state = randomBytes(24).toString("base64url");
    await this.updateStore({ state });
    return state;
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    return (await this.readStore()).clientInformation;
  }

  async saveClientInformation(value: OAuthClientInformationMixed): Promise<void> {
    await this.updateStore({ clientInformation: value });
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    return (await this.readStore()).tokens;
  }

  async saveTokens(value: OAuthTokens): Promise<void> {
    await this.updateStore({ tokens: value });
  }

  async redirectToAuthorization(url: URL): Promise<void> {
    this.authorizationUrl = url.toString();
  }

  async saveCodeVerifier(value: string): Promise<void> {
    await this.updateStore({ codeVerifier: value });
  }

  async codeVerifier(): Promise<string> {
    const value = (await this.readStore()).codeVerifier;
    if (!value) throw new Error("No OAuth code verifier saved");
    return value;
  }

  async invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier"): Promise<void> {
    const store = await this.readStore();
    if (scope === "all" || scope === "client") delete store.clientInformation;
    if (scope === "all" || scope === "tokens") delete store.tokens;
    if (scope === "all" || scope === "verifier") {
      delete store.codeVerifier;
      delete store.state;
    }
    await this.writeStore(store);
  }

  async deleteStore(): Promise<boolean> {
    try {
      await rm(this.storePath);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }

  async readStore(): Promise<OAuthStore> {
    try {
      return JSON.parse(await readFile(this.storePath, "utf8"));
    } catch {
      return {};
    }
  }

  async updateStore(patch: Partial<OAuthStore>): Promise<void> {
    await this.writeStore({ ...(await this.readStore()), ...patch });
  }

  async writeStore(store: OAuthStore): Promise<void> {
    await mkdir(dirname(this.storePath), { recursive: true });
    await writeFile(this.storePath, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
    await chmod(this.storePath, 0o600);
  }
}

function defaultAuthStorePath(): string {
  return join(
    process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
    "linear-axi",
    "oauth.json",
  );
}
