// The repository is public and its alpha-device runner is the release owner's builder (P-58).
// No workflow that can run on it may be triggered by a pull request, and its push trigger may
// only name main. This is a static workflow check, not a runner or job execution.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const dir = path.resolve(import.meta.dirname, "..", ".github/workflows");
const workflows = fs.readdirSync(dir).filter(name => /\.ya?ml$/.test(name)).map(name => ({ name, text: fs.readFileSync(path.join(dir, name), "utf8") }));

/** Top-level `on:` block text (until the next top-level key). */
function triggers(text) {
  const match = text.match(/^on:\s*\n((?:[ \t]+.*\n|\s*\n)*)/m) ?? text.match(/^on:\s*(.+)$/m);
  return match ? match[1] : "";
}

test("self-hosted jobs are never reachable from pull requests or non-main pushes", () => {
  const selfHosted = workflows.filter(({ text }) => /runs-on:.*(self-hosted|alpha-device)/.test(text));
  for (const { name, text } of selfHosted) {
    const on = triggers(text);
    assert.doesNotMatch(on, /pull_request|issue_comment|workflow_run|repository_dispatch/, `${name} must not run self-hosted jobs from ${on.trim()}`);
    const push = on.match(/^\s*push:\s*\n((?:\s{4,}.*\n)*)/m);
    if (push) assert.match(push[1], /branches:\s*\[\s*main\s*\]/, `${name} may push-trigger only on main`);
  }
});

test("the guard recognises a pull-request trigger", () => {
  assert.match(triggers("name: x\non:\n  pull_request:\n  push:\njobs:\n"), /pull_request/);
  assert.match(triggers("on: [pull_request]\n"), /pull_request/);
});
