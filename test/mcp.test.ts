import test from "node:test";
import assert from "node:assert/strict";
import { LinearMcpClient, LinearOAuthProvider } from "../src/mcp.ts";
import { DEFAULT_MCP_URL } from "../src/config.ts";
import { chmod, mkdtemp, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const OTHER_URL = "https://mcp.example.test/mcp";

async function tempStorePath() {
  const dir = await mkdtemp(join(tmpdir(), "linear-axi-oauth-"));
  return join(dir, "oauth.json");
}

test("remote client uses OAuth provider when no bearer token is configured", async () => {
  const storePath = await tempStorePath();
  const client = new LinearMcpClient({
    url: DEFAULT_MCP_URL,
    version: "0.0.0-test",
    authStorePath: storePath,
  });

  assert.ok(client.authProvider instanceof LinearOAuthProvider);
  assert.equal(client.authProvider.serverUrl, DEFAULT_MCP_URL);
});

test("remote client keeps bearer token path for token endpoints", () => {
  const client = new LinearMcpClient({ url: OTHER_URL, version: "0.0.0-test", token: "secret" });

  assert.equal(client.authProvider, null);
});

test("OAuth provider persists state for Linear CSRF validation", async () => {
  const storePath = await tempStorePath();
  const provider = new LinearOAuthProvider({ storePath, serverUrl: DEFAULT_MCP_URL });

  const first = await provider.state();
  const second = await new LinearOAuthProvider({ storePath, serverUrl: DEFAULT_MCP_URL }).state();

  assert.equal(first, second);

  await provider.invalidateCredentials("verifier");
  assert.notEqual(await provider.state(), first);
});

test("OAuth tokens are scoped to the MCP server URL", async () => {
  const storePath = await tempStorePath();
  const linear = new LinearOAuthProvider({ storePath, serverUrl: DEFAULT_MCP_URL });
  const other = new LinearOAuthProvider({ storePath, serverUrl: OTHER_URL });

  await linear.saveTokens({ access_token: "linear-token", token_type: "Bearer" });

  assert.equal(await other.tokens(), undefined);
  assert.equal((await linear.tokens())?.access_token, "linear-token");

  await other.saveTokens({ access_token: "other-token", token_type: "Bearer" });
  assert.equal((await linear.tokens())?.access_token, "linear-token");
  assert.equal((await other.tokens())?.access_token, "other-token");
});

test("legacy flat OAuth store is only used for the default Linear URL", async () => {
  const storePath = await tempStorePath();
  await writeFile(
    storePath,
    JSON.stringify({ tokens: { access_token: "legacy-token", token_type: "Bearer" } }),
    "utf8",
  );

  const linear = new LinearOAuthProvider({ storePath, serverUrl: DEFAULT_MCP_URL });
  const other = new LinearOAuthProvider({ storePath, serverUrl: OTHER_URL });

  assert.equal((await linear.tokens())?.access_token, "legacy-token");
  assert.equal(await other.tokens(), undefined);
});

test("OAuth logout removes only the current server's credentials", async () => {
  const storePath = await tempStorePath();
  const linear = new LinearOAuthProvider({ storePath, serverUrl: DEFAULT_MCP_URL });
  const other = new LinearOAuthProvider({ storePath, serverUrl: OTHER_URL });
  await linear.saveTokens({ access_token: "linear-token", token_type: "Bearer" });
  await other.saveTokens({ access_token: "other-token", token_type: "Bearer" });

  assert.equal(await linear.deleteStore(), true);
  assert.equal(await linear.tokens(), undefined);
  assert.equal((await other.tokens())?.access_token, "other-token");

  assert.equal(await other.deleteStore(), true);
  await assert.rejects(() => stat(storePath), /ENOENT/);
  assert.equal(await other.deleteStore(), false);
});

test("OAuth logout of a legacy store clears the default URL credentials", async () => {
  const storePath = await tempStorePath();
  await writeFile(
    storePath,
    JSON.stringify({ tokens: { access_token: "legacy-token", token_type: "Bearer" } }),
    "utf8",
  );
  const linear = new LinearOAuthProvider({ storePath, serverUrl: DEFAULT_MCP_URL });

  assert.equal(await linear.deleteStore(), true);
  assert.equal(await linear.tokens(), undefined);
});

test("OAuth provider tightens permissions on existing token store", async () => {
  const storePath = await tempStorePath();
  const provider = new LinearOAuthProvider({ storePath, serverUrl: DEFAULT_MCP_URL });

  await provider.saveTokens({ access_token: "initial", token_type: "Bearer" });
  await chmod(storePath, 0o666);
  await provider.saveTokens({ access_token: "updated", token_type: "Bearer" });

  assert.equal((await stat(storePath)).mode & 0o777, 0o600);
});
