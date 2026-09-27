import test from "node:test";
import assert from "node:assert/strict";
import { compactIssues } from "../src/lib/linear-format.ts";

test("compact issue sorting preserves input order within the same status", () => {
  assert.deepEqual(
    compactIssues([
      { identifier: "LIN-2", title: "Second", state: "Todo" },
      { identifier: "LIN-1", title: "First", state: "Todo" },
    ]).map((issue) => issue.id),
    ["LIN-2", "LIN-1"],
  );
});
