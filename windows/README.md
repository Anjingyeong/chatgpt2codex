# ChatGPT To Codex for Windows

Beginner install:

1. Download `chatgpt2codex-0.2.0-windows-setup.exe` from the official GitHub release:
   <https://github.com/ezBuilder/chatgpt2codex/releases/tag/v0.2.0>
2. Double-click the installer.
3. If Windows SmartScreen appears, choose **More info** -> **Run anyway** only
   when the file came from the official release page.
4. Open **ChatGPT To Codex**.
5. Confirm the tray icon appears near the clock.
6. Open **Settings...**, choose a project folder, enable the ChatGPT web
   connector if needed, then click **Start MCP**.
7. Copy the `/mcp` Connector URL and approve it in ChatGPT with the Owner Token.

Keep the Owner Token private. Treat it like a password.

Portable/source install:

- From a packaged folder, double-click `ChatGPT To Codex.exe`.
- If the exe has not been built yet, run `windows\Build-ChatGPTToCodexExe.ps1`
  once on Windows.
- Fallback launcher: `windows\Start-ChatGPTToCodexTray.cmd`.

Development package behavior:

- When `ChatGPT To Codex.exe` is launched from this repository's
  `build\windows\chatgpt2codex` directory, the packaged launcher detects the
  source checkout three levels above it and delegates to the source
  `start-chatgpt.ps1`.
- The source launcher checks whether `src`, `package.json`, `package-lock.json`,
  or `tsconfig.json` is newer than `dist\cli.js`. If so, it automatically runs
  `npm run build` before starting MCP.
- This means normal development no longer requires rebuilding the Windows exe or
  copying `dist` after every TypeScript change. Edit source, restart MCP, and the
  launcher rebuilds and uses the current source checkout automatically.
- Installed or extracted release packages outside that exact development layout
  do not delegate to a source checkout and keep using their bundled `dist`.
- Run `npm run windows:launcher:test` to verify source-root detection, stale-build
  detection, PowerShell parsing, and, when present, generated-launcher sync.

The app uses `winget` to install Node.js LTS and `cloudflared` only when they
are missing, then opens a tray controller. Starting MCP is loopback-only by
default. For ChatGPT web, prefer your own stable hostname; use temporary Quick
Tunnel URLs only for short tests because they change after restart.

The tray menu stays deliberately small:

- Start/Stop/Restart MCP.
- Open Settings.
- Quit.

Settings contains the busy stuff: project folder, ChatGPT web connector, owned
fixed domain, port, launch-at-login, start-on-open, update checks, language
override, connector URL, health links, logs, releases, and the copyright footer.
GitHub is a direct button, not a text setting.

First prompt to try in ChatGPT:

```text
Use ChatGPT To Codex. Select my project, read the README and package scripts,
run the safest available check, then summarize the result with exact evidence.
```

E2E screenshot prompt:

```text
Use ChatGPT To Codex to run E2E, open the app, capture screenshots, and show them inline.
```

For local web projects, Windows E2E capture launches an installed Microsoft Edge
or Google Chrome with an isolated temporary profile and uses the local Chrome
DevTools Protocol to save deterministic browser viewports under
`.chatgpt2codex/e2e/screenshots`. The one-shot E2E flow captures desktop
top/middle/bottom plus mobile (390x844) top/middle/bottom views. It does not
require the target browser window to remain visible on screen.

Troubleshooting:

- If SmartScreen appears, verify the installer came from the official GitHub
  release before running it.
- If the connector URL is empty, open Settings, enable ChatGPT web connector,
  click **Start MCP**, then copy the URL again.
- If port 7676 is busy, use **Restart MCP** from the tray menu. The launcher
  cleans up stale runtime processes before restart.
- For local web screenshots, confirm Microsoft Edge or Google Chrome is installed.
  Desktop-app window capture still has separate platform limitations.
- If ChatGPT asks for approval, paste the Owner Token from the Windows app.

The tray UI follows the Windows display language by default and can be changed
in Settings. Supported UI languages: English, Korean, Japanese, Simplified
Chinese, Traditional Chinese, Spanish, French, German, Brazilian Portuguese,
Italian, Dutch, Polish, Russian, Turkish, Vietnamese, Indonesian, Thai, Arabic,
Hindi, and Ukrainian.

For first-time machine setup from a source checkout:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup-windows.ps1 -RepoUrl https://github.com/ezBuilder/chatgpt2codex.git -Launch
```

For source-free users, ship the Windows zip from `npm run windows:package`.
They only need to unzip it and double-click `ChatGPT To Codex.exe`.

Copyright 2026 ezBuilder. All rights reserved.
