import { test } from "node:test";
import { execFileSync } from "node:child_process";
test("native source is pinned and unmodified", () => {
  execFileSync("node", ["scripts/verify-upstream.mjs"]);
});
