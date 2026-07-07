import { spawn, execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { DomainError, ErrorCode } from "../types.js";
import { resolveInProject } from "../policy/paths.js";
import { redact } from "../policy/secrets.js";
import { buildSafeChildEnv } from "../exec/command-runner.js";
import { guardShellCommand } from "../exec/local-shell.js";

export interface E2eScreenshotResult {
  path: string;
  bytes: number;
  opened: boolean;
  captureMode: "screen" | "browser-region" | "app-window";
  targetUrl?: string;
  targetAppName?: string;
  shotLabel?: string;
}

function slug(value: string): string {
  const clean = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return clean || "e2e";
}

function e2eId(seed: string): string {
  const digest = createHash("sha256").update(seed).digest("hex").slice(0, 8);
  return `e2e-${Date.now()}-${digest}`;
}

async function e2eDir(projectRoot: string): Promise<string> {
  const dir = path.join(projectRoot, ".chatgpt2codex", "e2e");
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

function execFileAsync(file: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { env: buildSafeChildEnv(), windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
    });
  });
}

function appleScriptString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function powerShellExe(): string {
  const systemRoot = process.env.SystemRoot ?? process.env.WINDIR;
  if (systemRoot) {
    return path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  }
  return "powershell.exe";
}

function cmdExe(): string {
  return process.env.ComSpec ?? process.env.COMSPEC ?? "cmd.exe";
}

function shellInvocation(command: string): { file: string; args: string[] } {
  if (process.platform === "win32") {
    return { file: cmdExe(), args: ["/d", "/s", "/c", command] };
  }
  if (process.platform === "darwin") {
    return { file: "/bin/zsh", args: ["-lc", command] };
  }
  return { file: process.env.SHELL ?? "/bin/sh", args: ["-lc", command] };
}

async function execPowerShell(script: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "chatgpt2codex-ps-"));
  const scriptPath = path.join(dir, "script.ps1");
  try {
    await fs.writeFile(scriptPath, script, "utf8");
    return await execFileAsync(powerShellExe(), [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath,
      ...args,
    ]);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

const WINDOWS_SCREENSHOT_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$out = $args[0]
if ([string]::IsNullOrWhiteSpace($out)) { throw 'missing output path' }
$dir = [System.IO.Path]::GetDirectoryName($out)
if ($dir) { [System.IO.Directory]::CreateDirectory($dir) | Out-Null }
if ($args.Length -ge 5) {
  $x = [int]$args[1]
  $y = [int]$args[2]
  $width = [int]$args[3]
  $height = [int]$args[4]
} else {
  $bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
  $x = $bounds.X
  $y = $bounds.Y
  $width = $bounds.Width
  $height = $bounds.Height
}
if ($width -le 0 -or $height -le 0) { throw 'invalid screenshot bounds' }
$bitmap = [System.Drawing.Bitmap]::new($width, $height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
try {
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.CopyFromScreen($x, $y, 0, 0, [System.Drawing.Size]::new($width, $height), [System.Drawing.CopyPixelOperation]::SourceCopy)
  } finally {
    $graphics.Dispose()
  }
  $bitmap.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
} finally {
  $bitmap.Dispose()
}
`;

const WINDOWS_JPEG_PREVIEW_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$sourcePath = $args[0]
$destPath = $args[1]
$maxDim = [int]$args[2]
$quality = [long]$args[3]
$source = [System.Drawing.Image]::FromFile($sourcePath)
try {
  $largest = [Math]::Max([double]$source.Width, [double]$source.Height)
  $scale = [double]$maxDim / $largest
  if ($scale -gt 1.0) { $scale = 1.0 }
  $width = [Math]::Max(1, [int][Math]::Round($source.Width * $scale))
  $height = [Math]::Max(1, [int][Math]::Round($source.Height * $scale))
  $dest = [System.Drawing.Bitmap]::new($width, $height, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  try {
    $graphics = [System.Drawing.Graphics]::FromImage($dest)
    try {
      $graphics.Clear([System.Drawing.Color]::White)
      $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $graphics.DrawImage($source, 0, 0, $width, $height)
    } finally {
      $graphics.Dispose()
    }
    $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' } | Select-Object -First 1
    if (-not $codec) { throw 'jpeg codec not found' }
    $encoderParams = [System.Drawing.Imaging.EncoderParameters]::new(1)
    try {
      $encoderParams.Param[0] = [System.Drawing.Imaging.EncoderParameter]::new([System.Drawing.Imaging.Encoder]::Quality, $quality)
      $dest.Save($destPath, $codec, $encoderParams)
    } finally {
      $encoderParams.Dispose()
    }
  } finally {
    $dest.Dispose()
  }
} finally {
  $source.Dispose()
}
`;

const WINDOWS_WINDOW_REGION_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class ChatGPTToCodexWin32Bounds {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }
  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);
}
"@
$needle = [string]$args[0]
if ([string]::IsNullOrWhiteSpace($needle)) { throw 'missing app name' }
$needleLower = $needle.ToLowerInvariant()
$proc = Get-Process | Where-Object {
  $_.MainWindowHandle -ne 0 -and (
    $_.ProcessName.ToLowerInvariant().Contains($needleLower) -or
    ([string]$_.MainWindowTitle).ToLowerInvariant().Contains($needleLower)
  )
} | Sort-Object StartTime -Descending | Select-Object -First 1
if (-not $proc) { throw "app window not found: $needle" }
[void][ChatGPTToCodexWin32Bounds]::SetForegroundWindow($proc.MainWindowHandle)
Start-Sleep -Milliseconds 250
$rect = [ChatGPTToCodexWin32Bounds+RECT]::new()
if (-not [ChatGPTToCodexWin32Bounds]::GetWindowRect($proc.MainWindowHandle, [ref]$rect)) { throw 'could not read window bounds' }
$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top
if ($width -le 0 -or $height -le 0) { throw 'invalid app window bounds' }
"$($rect.Left),$($rect.Top),$width,$height"
`;

const WINDOWS_START_PROCESS_SCRIPT = `
$ErrorActionPreference = 'Stop'
$file = [string]$args[0]
$rest = @()
if ($args.Length -gt 1) { $rest = $args[1..($args.Length - 1)] }
if ($rest.Count -gt 0) {
  Start-Process -FilePath $file -ArgumentList $rest
} else {
  Start-Process -FilePath $file
}
`;

const WINDOWS_SEND_KEYS_SCRIPT = `
$ErrorActionPreference = 'Stop'
$shell = New-Object -ComObject WScript.Shell
Start-Sleep -Milliseconds 150
$shell.SendKeys([string]$args[0])
Start-Sleep -Milliseconds 350
`;

function parseRegion(region: string): { x: number; y: number; width: number; height: number } {
  const parts = region.split(",").map((part) => Number.parseInt(part.trim(), 10));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
    throw new Error(`invalid screenshot region: ${region}`);
  }
  const [x, y, width, height] = parts as [number, number, number, number];
  if (width <= 0 || height <= 0) {
    throw new Error(`invalid screenshot region: ${region}`);
  }
  return { x, y, width, height };
}

async function captureWindowsScreenshot(file: string, region?: { x: number; y: number; width: number; height: number }): Promise<void> {
  const args = region ? [file, String(region.x), String(region.y), String(region.width), String(region.height)] : [file];
  await execPowerShell(WINDOWS_SCREENSHOT_SCRIPT, args);
}

async function openFileForUser(file: string): Promise<void> {
  if (process.platform === "darwin") {
    await execFileAsync("/usr/bin/open", [file]);
    return;
  }
  if (process.platform === "win32") {
    await execPowerShell(WINDOWS_START_PROCESS_SCRIPT, [file]);
    return;
  }
  await execFileAsync("xdg-open", [file]);
}

async function startWindowsProcess(file: string, args: string[] = []): Promise<void> {
  await execPowerShell(WINDOWS_START_PROCESS_SCRIPT, [file, ...args]);
}

async function getWindowsAppWindowRegion(appName: string): Promise<string> {
  const { stdout } = await execPowerShell(WINDOWS_WINDOW_REGION_SCRIPT, [appName]);
  const parts = stdout.match(/-?\d+/g);
  if (!parts || parts.length < 4) {
    throw new Error(`invalid app window bounds: ${stdout.trim()}`);
  }
  return parts.slice(0, 4).join(",");
}

async function scrollWindowsActiveWindow(fraction: number): Promise<void> {
  await execPowerShell(WINDOWS_SEND_KEYS_SCRIPT, [fraction >= 1 ? "{END}" : "{PGDN}"]);
}

async function captureRegionScreenshot(
  projectRoot: string,
  input: {
    label: string;
    region: string;
    openAfterCapture?: boolean;
    captureMode: "browser-region" | "app-window";
    targetUrl?: string;
    targetAppName?: string;
    shotLabel?: string;
  },
): Promise<E2eScreenshotResult> {
  const root = await fs.realpath(projectRoot);
  const dir = path.join(await e2eDir(root), "screenshots");
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${Date.now()}-${slug(input.label)}.png`);
  if (process.platform === "darwin") {
    await execFileAsync("/usr/sbin/screencapture", ["-x", "-R", input.region, file]);
  } else if (process.platform === "win32") {
    await captureWindowsScreenshot(file, parseRegion(input.region));
  } else {
    throw new DomainError(ErrorCode.NOT_IMPLEMENTED, "Region E2E screenshots are currently supported on macOS and Windows");
  }
  const stat = await fs.stat(file);
  if (stat.size === 0) {
    throw new DomainError(
      ErrorCode.PERMISSION_DENIED,
      process.platform === "win32"
        ? "Windows E2E screenshot capture produced an empty file. Make sure the desktop session is unlocked and try again."
        : "macOS Screen Recording permission is required for E2E screenshots. Open ChatGPT To Codex > Screenshot Permission, enable ChatGPT To Codex in System Settings > Privacy & Security > Screen Recording, then retry.",
      { permission: process.platform === "win32" ? "desktop-capture" : "screen-recording" },
    );
  }
  const opened = input.openAfterCapture === true;
  if (opened) {
    await openFileForUser(file);
  }
  return {
    path: file,
    bytes: stat.size,
    opened,
    captureMode: input.captureMode,
    targetUrl: input.targetUrl,
    targetAppName: input.targetAppName,
    shotLabel: input.shotLabel,
  };
}

async function getAppWindowRegion(appName: string): Promise<string> {
  const { stdout } = await execFileAsync("/usr/bin/osascript", [
    "-e",
    `
    tell application ${appleScriptString(appName)} to activate
    tell application "System Events"
      repeat 80 times
        if exists process ${appleScriptString(appName)} then
          tell process ${appleScriptString(appName)}
            set frontmost to true
            if (count of windows) > 0 then
              set winPos to position of front window
              set winSize to size of front window
              return ((item 1 of winPos) as integer) & "," & ((item 2 of winPos) as integer) & "," & ((item 1 of winSize) as integer) & "," & ((item 2 of winSize) as integer)
            end if
          end tell
        end if
        delay 0.25
      end repeat
    end tell
    error "app window not found"
    `,
  ]);
  const parts = stdout.match(/-?\d+/g);
  if (!parts || parts.length < 4) {
    throw new Error(`invalid app window bounds: ${stdout.trim()}`);
  }
  return parts.slice(0, 4).join(",");
}

async function scrollAppWindow(appName: string): Promise<void> {
  await execFileAsync("/usr/bin/osascript", [
    "-e",
    `
    tell application "System Events"
      if exists process ${appleScriptString(appName)} then
        tell process ${appleScriptString(appName)}
          set frontmost to true
          key code 121
        end tell
      end if
    end tell
    `,
  ]);
}

async function scrollChromePage(fraction: number): Promise<void> {
  const clamped = Math.max(0, Math.min(1, fraction));
  await execFileAsync("/usr/bin/osascript", [
    "-e",
    `
    tell application "Google Chrome"
      execute active tab of front window javascript "window.scrollTo(0, Math.max(0, (document.documentElement.scrollHeight - window.innerHeight) * ${clamped}));"
    end tell
    `,
  ]);
}

async function scrollBrowserPage(fraction: number): Promise<void> {
  if (process.platform === "win32") {
    await scrollWindowsActiveWindow(fraction);
    return;
  }
  await scrollChromePage(fraction);
}

async function scrollTargetAppWindow(appName: string): Promise<void> {
  if (process.platform === "win32") {
    await getWindowsAppWindowRegion(appName);
    await scrollWindowsActiveWindow(0.5);
    return;
  }
  await scrollAppWindow(appName);
}

async function waitForUrl(url: string, timeoutSec: number): Promise<{ ok: boolean; status?: number; error?: string; elapsedMs: number }> {
  const started = Date.now();
  const deadline = started + timeoutSec * 1000;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2500);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      if (res.status < 500) {
        return { ok: true, status: res.status, elapsedMs: Date.now() - started };
      }
      lastError = `HTTP ${res.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await delay(500);
  }
  return { ok: false, error: lastError || "timeout", elapsedMs: Date.now() - started };
}

export async function startE2eServer(
  projectRoot: string,
  input: {
    command: string;
    cwd?: string;
    label?: string;
    waitUrl?: string;
    waitTimeoutSec?: number;
  },
): Promise<{
  runId: string;
  pid: number;
  cwd: string;
  logPath: string;
  wait?: { ok: boolean; status?: number; error?: string; elapsedMs: number };
}> {
  guardShellCommand(input.command);
  const root = await fs.realpath(projectRoot);
  const commandCwd = input.cwd ? await resolveInProject(root, input.cwd, { allowSymlink: false }) : root;
  const stat = await fs.stat(commandCwd).catch(() => null);
  if (!stat?.isDirectory()) {
    throw new DomainError(ErrorCode.PATH_OUTSIDE_PROJECT, "cwd is not a project directory", { cwd: input.cwd });
  }

  const dir = await e2eDir(root);
  const runId = e2eId(input.command);
  const logPath = path.join(dir, `${runId}-${slug(input.label ?? "server")}.log`);
  const out = await fs.open(logPath, "a");
  const invocation = shellInvocation(input.command);
  const child = spawn(invocation.file, invocation.args, {
    cwd: commandCwd,
    env: buildSafeChildEnv(),
    detached: true,
    windowsHide: true,
    stdio: ["ignore", out.fd, out.fd],
  });
  child.unref();
  await out.close();

  const wait = input.waitUrl ? await waitForUrl(input.waitUrl, input.waitTimeoutSec ?? 30) : undefined;
  return {
    runId,
    pid: child.pid ?? 0,
    cwd: path.relative(root, commandCwd) || ".",
    logPath,
    wait,
  };
}

export async function stopE2eServer(input: { pid: number }): Promise<{ stopped: boolean; error?: string }> {
  if (!input.pid || input.pid < 1) {
    return { stopped: false, error: "missing pid" };
  }
  try {
    if (process.platform === "win32") {
      await execFileAsync("taskkill.exe", ["/pid", String(input.pid), "/t", "/f"]).catch(() => ({ stdout: "", stderr: "" }));
    } else {
      process.kill(-input.pid, "SIGTERM");
      await delay(500);
    }
    return { stopped: true };
  } catch (error) {
    return { stopped: false, error: summarizeE2eError(error) };
  }
}

export async function openE2eTarget(input: { url?: string; appName?: string; appPath?: string; args?: string[] }): Promise<{
  launched: string;
}> {
  if (process.platform === "win32") {
    if (input.url) {
      await startWindowsProcess(input.url);
      return { launched: input.url };
    }
    if (input.appPath) {
      await startWindowsProcess(input.appPath, input.args);
      return { launched: input.appPath };
    }
    if (input.appName) {
      await startWindowsProcess(input.appName, input.args);
      return { launched: input.appName };
    }
    throw new DomainError(ErrorCode.NOT_IMPLEMENTED, "Provide url, appName, or appPath");
  }

  if (input.url) {
    if (process.platform === "darwin") {
      await execFileAsync("/usr/bin/open", [input.url]);
    } else {
      await execFileAsync("xdg-open", [input.url]);
    }
    return { launched: input.url };
  }
  if (input.appPath) {
    if (process.platform === "darwin") {
      await execFileAsync("/usr/bin/open", [input.appPath, ...(input.args?.length ? ["--args", ...input.args] : [])]);
    } else {
      const child = spawn(input.appPath, input.args ?? [], {
        detached: true,
        env: buildSafeChildEnv(),
        stdio: "ignore",
      });
      child.unref();
    }
    return { launched: input.appPath };
  }
  if (input.appName) {
    if (process.platform === "darwin") {
      await execFileAsync("/usr/bin/open", ["-a", input.appName, ...(input.args?.length ? ["--args", ...input.args] : [])]);
    } else {
      const child = spawn(input.appName, input.args ?? [], {
        detached: true,
        env: buildSafeChildEnv(),
        stdio: "ignore",
      });
      child.unref();
    }
    return { launched: input.appName };
  }
  throw new DomainError(ErrorCode.NOT_IMPLEMENTED, "Provide url, appName, or appPath");
}

export interface E2eScreenshotPreview {
  path: string;
  bytes: number;
  mimeType: "image/jpeg";
}

const PREVIEW_MAX_DIMENSION = "1200";
const PREVIEW_JPEG_QUALITY = "70";

/**
 * Downscaled JPEG preview of a captured PNG screenshot, written next to the
 * original as `<name>-preview.jpg`. Full-resolution retina PNGs are too large
 * to inline into chat clients; the preview keeps inline delivery (widget data
 * URIs, MCP image content) small. Returns null when sips is unavailable or
 * conversion fails so callers can fall back to the original PNG.
 */
export async function createE2eScreenshotPreview(screenshotPath: string): Promise<E2eScreenshotPreview | null> {
  if (!screenshotPath.endsWith(".png")) return null;
  const previewPath = `${screenshotPath.slice(0, -4)}-preview.jpg`;
  try {
    const existing = await fs.stat(previewPath).catch(() => null);
    if (!existing?.isFile() || existing.size === 0) {
      if (process.platform === "darwin") {
        await execFileAsync("/usr/bin/sips", [
          "--resampleHeightWidthMax",
          PREVIEW_MAX_DIMENSION,
          "-s",
          "format",
          "jpeg",
          "-s",
          "formatOptions",
          PREVIEW_JPEG_QUALITY,
          screenshotPath,
          "--out",
          previewPath,
        ]);
      } else if (process.platform === "win32") {
        await execPowerShell(WINDOWS_JPEG_PREVIEW_SCRIPT, [screenshotPath, previewPath, PREVIEW_MAX_DIMENSION, PREVIEW_JPEG_QUALITY]);
      } else {
        return null;
      }
    }
    const stat = await fs.stat(previewPath);
    if (!stat.isFile() || stat.size === 0) return null;
    return { path: previewPath, bytes: stat.size, mimeType: "image/jpeg" };
  } catch {
    return null;
  }
}

export async function captureE2eScreenshot(
  projectRoot: string,
  input: { label?: string; waitMs?: number; openAfterCapture?: boolean },
): Promise<E2eScreenshotResult> {
  if (process.platform !== "darwin" && process.platform !== "win32") {
    throw new DomainError(ErrorCode.NOT_IMPLEMENTED, "E2E screenshots are currently supported on macOS and Windows");
  }
  if (input.waitMs && input.waitMs > 0) {
    await delay(Math.min(input.waitMs, 30_000));
  }
  const root = await fs.realpath(projectRoot);
  const dir = path.join(await e2eDir(root), "screenshots");
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${Date.now()}-${slug(input.label ?? "screen")}.png`);
  try {
    if (process.platform === "darwin") {
      await execFileAsync("/usr/sbin/screencapture", ["-x", file]);
    } else {
      await captureWindowsScreenshot(file);
    }
  } catch (error) {
    throw new DomainError(
      ErrorCode.PERMISSION_DENIED,
      process.platform === "win32"
        ? "Windows E2E screenshot capture failed. Make sure the desktop session is unlocked and try again."
        : "macOS Screen Recording permission is required for E2E screenshots. Open ChatGPT To Codex > Screenshot Permission, enable ChatGPT To Codex in System Settings > Privacy & Security > Screen Recording, then retry.",
      {
        permission: process.platform === "win32" ? "desktop-capture" : "screen-recording",
        cause: summarizeE2eError(error),
      },
    );
  }
  const stat = await fs.stat(file);
  if (stat.size === 0) {
    throw new DomainError(
      ErrorCode.PERMISSION_DENIED,
      process.platform === "win32"
        ? "Windows E2E screenshot capture produced an empty file. Make sure the desktop session is unlocked and try again."
        : "macOS Screen Recording permission is required for E2E screenshots. Open ChatGPT To Codex > Screenshot Permission, enable ChatGPT To Codex in System Settings > Privacy & Security > Screen Recording, then retry.",
      { permission: process.platform === "win32" ? "desktop-capture" : "screen-recording" },
    );
  }
  const opened = input.openAfterCapture === true;
  if (opened) {
    await openFileForUser(file);
  }
  return { path: file, bytes: stat.size, opened, captureMode: "screen" };
}

export async function captureE2eUrlScreenshot(
  projectRoot: string,
  input: {
    url: string;
    label?: string;
    waitMs?: number;
    openAfterCapture?: boolean;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  },
): Promise<E2eScreenshotResult> {
  const x = input.x ?? 80;
  const y = input.y ?? 80;
  const width = input.width ?? 1440;
  const height = input.height ?? 900;

  if (process.platform === "win32") {
    await openE2eTarget({ url: input.url });
    if (input.waitMs && input.waitMs > 0) {
      await delay(Math.min(input.waitMs, 30_000));
    }
    return captureRegionScreenshot(projectRoot, {
      label: input.label ?? "url",
      region: `${x},${y},${width},${height}`,
      openAfterCapture: input.openAfterCapture,
      captureMode: "browser-region",
      targetUrl: input.url,
      shotLabel: input.label,
    });
  }

  if (process.platform !== "darwin") {
    throw new DomainError(ErrorCode.NOT_IMPLEMENTED, "Browser-region E2E screenshots are currently supported on macOS and Windows");
  }

  try {
    const right = x + width;
    const bottom = y + height;
    await execFileAsync("/usr/bin/osascript", [
      "-e",
      `
      tell application "Google Chrome"
        activate
        if (count of windows) = 0 then make new window
        set bounds of front window to {${x}, ${y}, ${right}, ${bottom}}
        set URL of active tab of front window to ${appleScriptString(input.url)}
      end tell
      `,
    ]);
  } catch {
    await openE2eTarget({ url: input.url });
    return captureE2eScreenshot(projectRoot, {
      label: input.label ?? "url-fallback",
      waitMs: input.waitMs ?? 1500,
      openAfterCapture: input.openAfterCapture,
    });
  }

  if (input.waitMs && input.waitMs > 0) {
    await delay(Math.min(input.waitMs, 30_000));
  }
  return captureRegionScreenshot(projectRoot, {
    label: input.label ?? "url",
    region: `${x},${y},${width},${height}`,
    openAfterCapture: input.openAfterCapture,
    captureMode: "browser-region",
    targetUrl: input.url,
    shotLabel: input.label,
  });
}

export async function captureE2eUrlScreenshotSet(
  projectRoot: string,
  input: {
    url: string;
    label?: string;
    waitMs?: number;
    openAfterCapture?: boolean;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  },
): Promise<E2eScreenshotResult[]> {
  const x = input.x ?? 80;
  const y = input.y ?? 80;
  const width = input.width ?? 1440;
  const height = input.height ?? 900;
  const shots: E2eScreenshotResult[] = [];
  shots.push(
    await captureE2eUrlScreenshot(projectRoot, {
      ...input,
      label: `${input.label ?? "url"}-top`,
      openAfterCapture: false,
    }),
  );
  for (const [shotLabel, fraction] of [
    ["middle", 0.5],
    ["bottom", 1],
  ] as const) {
    try {
      await scrollBrowserPage(fraction);
      await delay(input.waitMs ?? 900);
      shots.push(
        await captureRegionScreenshot(projectRoot, {
          label: `${input.label ?? "url"}-${shotLabel}`,
          region: `${x},${y},${width},${height}`,
          openAfterCapture: false,
          captureMode: "browser-region",
          targetUrl: input.url,
          shotLabel,
        }),
      );
    } catch {
      // A page may not be scrollable or Chrome automation may be unavailable.
    }
  }
  if (input.openAfterCapture && shots[0]) {
    await openFileForUser(shots[0].path);
    shots[0].opened = true;
  }
  return shots;
}

export async function captureE2eAppScreenshot(
  projectRoot: string,
  input: {
    appName: string;
    label?: string;
    waitMs?: number;
    openAfterCapture?: boolean;
  },
): Promise<E2eScreenshotResult> {
  if (process.platform !== "darwin" && process.platform !== "win32") {
    throw new DomainError(ErrorCode.NOT_IMPLEMENTED, "App-window E2E screenshots are currently supported on macOS and Windows");
  }
  if (input.waitMs && input.waitMs > 0) {
    await delay(Math.min(input.waitMs, 30_000));
  }

  let region = "";
  try {
    region = process.platform === "win32" ? await getWindowsAppWindowRegion(input.appName) : await getAppWindowRegion(input.appName);
  } catch (error) {
    throw new DomainError(
      ErrorCode.PERMISSION_DENIED,
      process.platform === "win32"
        ? `Could not find a visible Windows app window for ${input.appName}. Open the app and retry.`
        : `macOS Accessibility permission is required to capture the ${input.appName} app window. Enable ChatGPT To Codex in System Settings > Privacy & Security > Accessibility, then retry.`,
      {
        permission: process.platform === "win32" ? "visible-window" : "accessibility",
        appName: input.appName,
        cause: summarizeE2eError(error),
      },
    );
  }

  return captureRegionScreenshot(projectRoot, {
    label: input.label ?? input.appName,
    region,
    openAfterCapture: input.openAfterCapture,
    captureMode: "app-window",
    targetAppName: input.appName,
    shotLabel: input.label,
  });
}

export async function captureE2eAppScreenshotSet(
  projectRoot: string,
  input: {
    appName: string;
    label?: string;
    waitMs?: number;
    openAfterCapture?: boolean;
  },
): Promise<E2eScreenshotResult[]> {
  const shots: E2eScreenshotResult[] = [];
  shots.push(
    await captureE2eAppScreenshot(projectRoot, {
      ...input,
      label: `${input.label ?? input.appName}-top`,
      openAfterCapture: false,
    }),
  );
  for (const shotLabel of ["middle", "bottom"] as const) {
    try {
      await scrollTargetAppWindow(input.appName);
      await delay(input.waitMs ?? 900);
      shots.push(
        await captureE2eAppScreenshot(projectRoot, {
          ...input,
          label: `${input.label ?? input.appName}-${shotLabel}`,
          openAfterCapture: false,
        }),
      );
    } catch {
      // Some app windows do not accept Page Down; keep the successful shots.
    }
  }
  if (input.openAfterCapture && shots[0]) {
    await openFileForUser(shots[0].path);
    shots[0].opened = true;
  }
  return shots;
}

export function summarizeE2eError(error: unknown): string {
  return redact(error instanceof Error ? error.message : String(error));
}
