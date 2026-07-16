import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createSkillMarkdown, extractCommandsBlock, SKILL_DESCRIPTION } from "../src/skill.ts";

const readJson = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));

test("skill markdown is installable and points agents at linear-axi", () => {
  const skill = createSkillMarkdown();

  assert.match(skill, /^---\nname: linear-axi\n/m);
  assert.match(
    skill,
    new RegExp(
      `description: ${JSON.stringify(SKILL_DESCRIPTION).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
    ),
  );
  assert.match(skill, /npm install -g @nikolauska\/linear-axi/);
  assert.doesNotMatch(skill, /npx -y/);
  assert.match(skill, /auth login/);
  assert.match(skill, /linear-axi update --check/);
  assert.doesNotMatch(skill, /gh-axi/);
});

test("skill command block is generated from top help", () => {
  assert.equal(
    extractCommandsBlock(),
    `commands[12]:
  (none)=dashboard, init, auth, issues, projects, teams, users, comments, documents, milestones, cycles, statuses, labels`,
  );
});

test("plugin manifests package the existing skill for supported hosts", () => {
  const packageJson = readJson("../package.json");
  const marketplace = readJson("../.claude-plugin/marketplace.json");
  const manifests = [
    readJson("../.claude-plugin/plugin.json"),
    readJson("../.codex-plugin/plugin.json"),
  ];

  assert.equal(marketplace.name, "linear-axi");
  assert.equal(marketplace.plugins.length, 1);
  assert.equal(marketplace.plugins[0].name, "linear-axi");
  assert.equal(marketplace.plugins[0].source, "./");

  for (const manifest of manifests) {
    assert.equal(manifest.name, "linear-axi");
    assert.equal(manifest.version, packageJson.version);
    assert.equal(manifest.skills, "./skills/");
  }

  assert.equal(manifests[1].interface.displayName, "linear-axi");
  assert.deepEqual(manifests[1].interface.capabilities, ["Instructions"]);
});
