import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { defaultConfig } from "../src/config.js";
import { GitHubCommandRunner, registerGitHubTools } from "../src/github.js";
import { ToolRegistry } from "../src/tools.js";

class FakeGh implements GitHubCommandRunner {
  calls: string[][] = [];

  run(args: string[]) {
    this.calls.push(args);
    const command = args.slice(0, 2).join(" ");
    if (command === "auth status") {
      return { status: 0, stdout: "", stderr: "Logged in to github.com account test-user" };
    }
    if (command === "pr list") {
      return { status: 0, stdout: JSON.stringify([{ number: 7, title: "Ship connector", state: "OPEN", author: { login: "ana" }, url: "https://github.com/o/r/pull/7" }]), stderr: "" };
    }
    if (command === "pr view") {
      return { status: 0, stdout: JSON.stringify({ number: 7, title: "Ship connector", state: "OPEN", author: { login: "ana" } }), stderr: "" };
    }
    if (command === "issue create") {
      return { status: 0, stdout: "https://github.com/o/r/issues/8\n", stderr: "" };
    }
    return { status: 0, stdout: "[]", stderr: "" };
  }
}

function registryWithFakeGh() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "butterclaw-gh-"));
  const config = defaultConfig({ workspace: root, configDir: path.join(root, ".config"), githubDefaultRepo: "openclaw/openclaw" });
  const registry = new ToolRegistry();
  const runner = new FakeGh();
  registerGitHubTools(registry, config, runner);
  return { registry, runner };
}

test("github tools use gh json output and configured repo", async () => {
  const { registry, runner } = registryWithFakeGh();

  const status = await registry.call("github_status", {});
  const prs = await registry.call("github_pr_list", {});
  const pr = await registry.call("github_pr_view", { pr: 7 });

  assert.equal(status.ok, true);
  assert.match(status.output, /GitHub OAuth is connected/);
  assert.equal(prs.ok, true);
  assert.match(prs.output, /Ship connector/);
  assert.equal(pr.ok, true);
  assert.match(pr.output, /number: 7/);
  assert.equal(runner.calls.some((call) => call.includes("openclaw/openclaw")), true);
});

test("github issue creation goes through gh without storing tokens", async () => {
  const { registry, runner } = registryWithFakeGh();

  const result = await registry.call("github_issue_create", { repo: "owner/repo", title: "Bug", body: "Details" });

  assert.equal(result.ok, true);
  assert.match(result.output, /issues\/8/);
  const call = runner.calls.find((entry) => entry[0] === "issue" && entry[1] === "create");
  assert.deepEqual(call?.slice(0, 8), ["issue", "create", "--repo", "owner/repo", "--title", "Bug", "--body", "Details"]);
});
