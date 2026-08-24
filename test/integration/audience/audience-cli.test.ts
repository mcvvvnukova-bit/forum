import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

describe("audience CLI executable", () => {
  it("returns structured safe JSON for rejected source controls before loading environment", () => {
    const result = spawnSync(
      process.execPath,
      [
        "node_modules/tsx/dist/cli.mjs",
        "src/apps/browser-runner/main.ts",
        "fixture-discover",
        "--url",
        "https://user:secret@example.test/?token=must-not-appear",
      ],
      { cwd: process.cwd(), encoding: "utf8", env: {} },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      ok: false,
      error: "live URL options are forbidden",
    });
    expect(result.stdout).not.toMatch(/user|secret|example\.test|token|must-not-appear/);
  });

  it.each([
    [
      "credential-bearing unknown option",
      ["reconcile", "--credential=unknown-option-secret"],
      "unknown option",
      "unknown-option-secret",
    ],
    [
      "credential-bearing positional input",
      ["reconcile", "unexpected-positional-secret"],
      "unexpected argument",
      "unexpected-positional-secret",
    ],
  ])("sanitizes %s before returning public JSON", (_case, argv, message, secret) => {
    const result = spawnSync(
      process.execPath,
      ["node_modules/tsx/dist/cli.mjs", "src/apps/browser-runner/main.ts", ...argv],
      { cwd: process.cwd(), encoding: "utf8", env: {} },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({ ok: false, error: message });
    expect(result.stdout).not.toContain(secret);
  });
});
