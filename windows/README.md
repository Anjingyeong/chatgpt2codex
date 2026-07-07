# ChatGPT To Codex for Windows

Double-click `ChatGPT To Codex.exe` from the package root. If the exe has not been
built yet, run `windows\Build-ChatGPTToCodexExe.ps1` once on Windows or use the
fallback `windows\Start-ChatGPTToCodexTray.cmd`.

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
