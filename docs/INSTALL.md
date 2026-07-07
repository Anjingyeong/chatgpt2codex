# ChatGPT To Codex Installation Guide

Current macOS package: `installers/macos/chatgpt2codex-0.1.1.pkg`

SHA-256:

```text
abfaea077fdc1f09b3130700a2e2072432ceb4ac240a2565b460c834740e5496  chatgpt2codex-0.1.1.pkg
```

Windows can be built from source; a public beginner installer has not been published yet.

## Korean

### 이 앱은 무엇인가요?

ChatGPT To Codex는 내 Mac에서 실행되는 로컬 코딩 연결 앱입니다. ChatGPT가 내 전체 컴퓨터를 가져가는 것이 아니라, 내가 선택한 프로젝트 폴더 안에서만 파일 읽기, 코드 수정, 테스트 실행, E2E 스크린샷 캡처 같은 작업을 하게 해줍니다.

### PKG가 DMG보다 나은가요?

이번 릴리스는 PKG가 낫습니다. DMG는 드래그 앤 드롭 앱에는 예쁘지만, 이 앱은 Applications에 메뉴 막대 앱을 설치하고, 번들 런타임을 넣고, 설치 후 Doctor 점검을 돌리는 흐름이 필요합니다. 초보자에게는 PKG가 더 덜 헷갈립니다.

### 설치

1. `installers/macos/chatgpt2codex-0.1.1.pkg`를 다운로드합니다.
2. Finder에서 `.pkg` 파일을 엽니다.
3. macOS가 "확인할 수 없는 개발자" 또는 "악성 소프트웨어를 확인할 수 없음"이라고 막으면:
   - 파일을 Control-클릭 또는 오른쪽 클릭합니다.
   - **열기**를 누릅니다.
   - 그래도 막히면 **시스템 설정** -> **개인정보 보호 및 보안**에서 **그래도 열기**를 누릅니다.
4. 설치가 끝나면 **응용 프로그램**에서 **ChatGPT To Codex**를 실행합니다.
5. 화면 위 메뉴 막대에 아이콘이 보이면 실행된 것입니다.

### 첫 설정

1. 메뉴 막대 아이콘을 누릅니다.
2. **Settings...**를 엽니다.
3. **Project folder**에서 ChatGPT가 도와줄 프로젝트 폴더를 고릅니다.
4. ChatGPT 웹에서 연결하려면 **ChatGPT web connector**를 켭니다.
5. 고정 도메인이 없다면 도메인 칸은 비워둡니다. 그러면 임시 `trycloudflare.com` 주소가 만들어질 수 있습니다.
6. **Start MCP**를 누릅니다.
7. 상태가 켜질 때까지 기다립니다.
8. **Copy Connector URL**을 누릅니다. 주소는 `/mcp`로 끝나야 합니다.
9. ChatGPT의 Apps, Apps & Connectors, 또는 Connectors 설정에서 새 앱/커넥터를 만듭니다.
10. 복사한 `/mcp` 주소를 붙여넣습니다.
11. 승인 화면이 나오면 ChatGPT To Codex 앱에서 Owner Token을 복사해 입력합니다.

### E2E 스크린샷 사용

ChatGPT에 이렇게 말할 수 있습니다.

```text
ChatGPT To Codex로 앱을 실행하고 E2E 테스트를 돌린 뒤 스크린샷을 캡처해서 보여줘.
```

macOS 권한이 필요할 수 있습니다.

- **Screen Recording**: 화면 캡처용
- **Accessibility**: 특정 앱 창 위치를 잡고 캡처할 때 필요

막히면 **System Settings** -> **Privacy & Security**에서 ChatGPT To Codex 권한을 켜고 다시 실행하세요.

### 주의

- Owner Token은 비밀번호처럼 다루세요.
- 임시 `trycloudflare.com` 주소는 앱이나 터널을 재시작하면 바뀔 수 있습니다.
- Windows는 소스에서 빌드할 수 있지만, 공개 초보자용 설치파일은 아직 배포되지 않았습니다.

## English

### What is it?

ChatGPT To Codex is a local macOS app that lets ChatGPT work inside a project folder you choose. It can read files, apply patches, run checks, launch E2E flows, and send screenshot proof back to the chat.

### Why PKG instead of DMG?

PKG is better for this release. A DMG is great for drag-and-drop apps, but this app installs a menu bar runtime into Applications, bundles helper binaries, and runs a post-install Doctor. PKG gives beginners the clearest install path.

### Install

1. Download `installers/macos/chatgpt2codex-0.1.1.pkg`.
2. Open the package in Finder.
3. If macOS blocks it because it is unsigned, Control-click the file, choose **Open**, then confirm. If needed, open **System Settings** -> **Privacy & Security** -> **Open Anyway**.
4. Open **ChatGPT To Codex** from **Applications**.
5. Click the menu bar icon and open **Settings...**.
6. Choose your **Project folder**.
7. Enable **ChatGPT web connector** if ChatGPT in the browser needs to reach this Mac.
8. Click **Start MCP**.
9. Click **Copy Connector URL**. It should end with `/mcp`.
10. Add that URL in ChatGPT under Apps, Apps & Connectors, or Connectors.
11. Approve the connection with the Owner Token from the app.

### E2E screenshots

Try:

```text
Use ChatGPT To Codex to run E2E, open the app, capture screenshots, and show them inline.
```

macOS may ask for Screen Recording and Accessibility permissions. Enable them in **System Settings** -> **Privacy & Security**.

### Notes

- Keep the Owner Token private.
- Temporary `trycloudflare.com` URLs can change after restart.
- Windows can be built from source, but the public beginner installer is not published yet.

## Japanese

### 概要

ChatGPT To Codex は、Mac 上で動くローカル開発接続アプリです。選択したプロジェクトフォルダ内で、ChatGPT がファイル確認、パッチ適用、テスト実行、E2E スクリーンショット取得を行えるようにします。

### なぜ DMG ではなく PKG ですか?

今回のリリースでは PKG の方が適しています。メニューバーアプリを Applications に入れ、補助ランタイムを同梱し、インストール後の Doctor チェックを実行するため、初心者には PKG の方がわかりやすいです。

### インストール

1. `installers/macos/chatgpt2codex-0.1.1.pkg` をダウンロードします。
2. Finder で `.pkg` を開きます。
3. macOS にブロックされた場合は、ファイルを Control-クリックして **Open** を選びます。必要なら **System Settings** -> **Privacy & Security** -> **Open Anyway** を選びます。
4. **Applications** から **ChatGPT To Codex** を起動します。
5. メニューバーアイコンから **Settings...** を開きます。
6. **Project folder** を選びます。
7. ブラウザ版 ChatGPT と接続する場合は **ChatGPT web connector** を有効にします。
8. **Start MCP** を押します。
9. **Copy Connector URL** で `/mcp` で終わる URL をコピーします。
10. ChatGPT の Apps / Connectors 設定に登録します。
11. 承認画面ではアプリの Owner Token を入力します。

### E2E スクリーンショット

```text
ChatGPT To Codex で E2E を実行し、アプリを開いてスクリーンショットを表示して。
```

Screen Recording と Accessibility 権限が必要になる場合があります。

### 注意

- Owner Token は公開しないでください。
- 一時的な `trycloudflare.com` URL は再起動後に変わることがあります。
- Windows 版はソースからビルドできますが、初心者向けの公開インストーラはまだありません。

## Simplified Chinese

### 简介

ChatGPT To Codex 是一个在 Mac 本机运行的开发连接应用。它只连接你选择的项目文件夹，让 ChatGPT 可以读取文件、应用补丁、运行检查、执行 E2E，并把截图证据发回聊天。

### 为什么用 PKG 而不是 DMG?

当前版本更适合使用 PKG。DMG 适合拖拽式应用，但这个应用需要安装菜单栏运行时、打包辅助二进制文件，并在安装后运行 Doctor 检查。PKG 对初学者更清楚。

### 安装

1. 下载 `installers/macos/chatgpt2codex-0.1.1.pkg`。
2. 在 Finder 中打开 `.pkg` 文件。
3. 如果 macOS 因未签名而阻止安装，请 Control-点击文件，选择 **Open**。必要时到 **System Settings** -> **Privacy & Security** -> **Open Anyway**。
4. 从 **Applications** 打开 **ChatGPT To Codex**。
5. 点击菜单栏图标，打开 **Settings...**。
6. 选择 **Project folder**。
7. 如果要让网页版 ChatGPT 连接这台 Mac，请启用 **ChatGPT web connector**。
8. 点击 **Start MCP**。
9. 点击 **Copy Connector URL**，确认地址以 `/mcp` 结尾。
10. 在 ChatGPT 的 Apps 或 Connectors 设置里添加该地址。
11. 授权时输入应用里的 Owner Token。

### E2E 截图

可以这样要求 ChatGPT:

```text
Use ChatGPT To Codex to run E2E, open the app, capture screenshots, and show them inline.
```

macOS 可能需要 Screen Recording 和 Accessibility 权限。

### 注意

- 请不要公开 Owner Token。
- 临时 `trycloudflare.com` 地址重启后可能变化。
- Windows 版可以从源码构建，但面向新手的公开安装包尚未发布。
