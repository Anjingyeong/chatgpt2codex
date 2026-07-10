import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DomainError, ErrorCode } from "../types.js";
import { captureE2eUrlScreenshot, openE2eTarget } from "./local-e2e.js";

/**
 * captureE2eUrlScreenshot/openE2eTarget drive the owner's real, authenticated
 * Chrome (via osascript) or macOS's `open` to whatever URL they're given.
 * e2e_open_target and e2e_open_url_screenshot's tool handlers (src/server/
 * tools.ts) already validate the URL with isLocalHttpUrl before calling
 * in — but e2e_run_command's `screenshotUrl` input reached
 * captureUrlScreenshot with no caller-side check at all. These tests exercise
 * the defense-in-depth guard added directly inside this module (so every
 * current and future caller is covered, not just the ones that remember to
 * check), proving file://, internal-http, and other non-loopback URLs are
 * refused before any osascript/`open` invocation happens. There was
 * previously no test coverage for this file at all.
 */

let projectRoot: string;

beforeEach(async () => {
  projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "chatgpt2codex-local-e2e-"));
});

afterEach(async () => {
  await fs.rm(projectRoot, { recursive: true, force: true });
});

describe("captureE2eUrlScreenshot URL guard", () => {
  const nonLocalUrls = [
    "file:///etc/passwd",
    "file:///Users/someone/.ssh/id_rsa",
    "http://169.254.169.254/latest/meta-data/",
    "http://internal-dashboard.corp.example/",
    "https://evil.example/",
    "chrome://settings",
  ];

  for (const url of nonLocalUrls) {
    it(`refuses ${url} before touching osascript/Chrome`, async () => {
      await expect(captureE2eUrlScreenshot(projectRoot, { url })).rejects.toMatchObject({
        code: ErrorCode.APPROVAL_REQUIRED,
      });
    });
  }

  it("still throws a typed DomainError (not a raw string) for a rejected URL", async () => {
    await expect(captureE2eUrlScreenshot(projectRoot, { url: "file:///etc/passwd" })).rejects.toBeInstanceOf(DomainError);
  });
});

describe("openE2eTarget URL guard", () => {
  it("refuses a non-loopback url before calling /usr/bin/open", async () => {
    await expect(openE2eTarget({ url: "file:///etc/passwd" })).rejects.toMatchObject({
      code: ErrorCode.APPROVAL_REQUIRED,
    });
    await expect(openE2eTarget({ url: "smb://evil.example/share" })).rejects.toMatchObject({
      code: ErrorCode.APPROVAL_REQUIRED,
    });
  });
});
