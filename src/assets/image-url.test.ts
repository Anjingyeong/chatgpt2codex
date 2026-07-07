import { describe, expect, it } from "vitest";
import { DomainError, ErrorCode } from "../types.js";
import { fetchImageFromUrl, isBlockedAddress, type FetchLike } from "./image-url.js";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

/** Build a minimal fetch-like Response from a Buffer, streaming it through
 * a real ReadableStream so the byte-cap-enforcing reader path is exercised
 * exactly as it would be against the real global fetch. */
function makeResponse(
  status: number,
  bytes: Buffer,
  headers: Record<string, string> = {},
): Awaited<ReturnType<FetchLike>> {
  const headerMap = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(bytes));
      controller.close();
    },
  });
  return {
    status,
    headers: { get: (name: string) => headerMap.get(name.toLowerCase()) ?? null },
    body,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  };
}

function makeRedirect(status: number, location: string): Awaited<ReturnType<FetchLike>> {
  return makeResponse(status, Buffer.alloc(0), { location });
}

function chatGptPublicContentUrl(id: string): string {
  const encoded = Buffer.from(JSON.stringify({ id })).toString("base64url");
  return `https://chatgpt.com/backend-api/estuary/public_content/enc/${encoded}`;
}

/** DNS lookup stub: maps hostname -> resolved addresses, for tests that
 * don't want to depend on real DNS. */
function stubLookup(map: Record<string, Array<{ address: string; family: number }>>) {
  return async (hostname: string) => {
    const found = map[hostname];
    if (!found) throw new Error(`no stub DNS entry for ${hostname}`);
    return found;
  };
}

describe("isBlockedAddress", () => {
  it("blocks loopback, private, link-local/metadata, and unspecified addresses", () => {
    expect(isBlockedAddress("127.0.0.1")).toBe(true);
    expect(isBlockedAddress("10.0.0.5")).toBe(true);
    expect(isBlockedAddress("172.16.0.1")).toBe(true);
    expect(isBlockedAddress("192.168.1.1")).toBe(true);
    expect(isBlockedAddress("169.254.169.254")).toBe(true);
    expect(isBlockedAddress("0.0.0.0")).toBe(true);
    expect(isBlockedAddress("::1")).toBe(true);
    expect(isBlockedAddress("fe80::1")).toBe(true);
    expect(isBlockedAddress("fc00::1")).toBe(true);
  });

  it("allows a normal public address", () => {
    expect(isBlockedAddress("93.184.216.34")).toBe(false);
  });
});

describe("fetchImageFromUrl — success path (mocked fetch, offline)", () => {
  it("returns bytes + mime for a fake PNG served over https", async () => {
    const fetchImpl: FetchLike = async () => makeResponse(200, PNG_1X1, { "content-type": "image/png" });
    const lookupImpl = stubLookup({ "example.com": [{ address: "93.184.216.34", family: 4 }] });

    const result = await fetchImageFromUrl("https://example.com/cat.png", { fetchImpl, lookupImpl });

    expect(result.mime).toBe("image/png");
    expect(result.bytes.equals(PNG_1X1)).toBe(true);
  });

  it("follows a redirect that lands on an allowed public host", async () => {
    let call = 0;
    const fetchImpl: FetchLike = async () => {
      call++;
      if (call === 1) return makeRedirect(302, "https://cdn.example.com/cat.png");
      return makeResponse(200, PNG_1X1, { "content-type": "image/png" });
    };
    const lookupImpl = stubLookup({
      "example.com": [{ address: "93.184.216.34", family: 4 }],
      "cdn.example.com": [{ address: "93.184.216.35", family: 4 }],
    });

    const result = await fetchImageFromUrl("https://example.com/redirect", { fetchImpl, lookupImpl });
    expect(result.mime).toBe("image/png");
    expect(call).toBe(2);
  });

  it("resolves a ChatGPT image share page to its public image URL", async () => {
    const calls: string[] = [];
    const imageUrl = "https://chatgpt.com/backend-api/estuary/public_content/enc/abc?x=1&y=2";
    const shareHtml = Buffer.from(
      `<!doctype html><meta property="og:image" content="${imageUrl.replace(/&/g, "&amp;")}">`,
    );
    const fetchImpl: FetchLike = async (url) => {
      calls.push(url);
      if (url === "https://chatgpt.com/s/m_testshare") {
        return makeResponse(200, shareHtml, { "content-type": "text/html; charset=utf-8" });
      }
      return makeResponse(200, PNG_1X1, { "content-type": "image/png" });
    };
    const lookupImpl = stubLookup({ "chatgpt.com": [{ address: "93.184.216.34", family: 4 }] });

    const result = await fetchImageFromUrl("https://chatgpt.com/s/m_testshare", { fetchImpl, lookupImpl });

    expect(result.mime).toBe("image/png");
    expect(result.bytes.equals(PNG_1X1)).toBe(true);
    expect(calls).toEqual(["https://chatgpt.com/s/m_testshare", imageUrl]);
  });

  it("prefers the original file URL over ChatGPT share-page preview variants", async () => {
    const originalUrl = chatGptPublicContentUrl("m_share:file_abc123");
    const unfurlUrl = chatGptPublicContentUrl("m_share:sediment://one#file_abc123#unfurl");
    const mediumUrl = chatGptPublicContentUrl("m_share:sediment://two#file_abc123#md");
    const calls: string[] = [];
    const shareHtml = Buffer.from(
      `<!doctype html>
      <meta property="og:image" content="${unfurlUrl}">
      <script>${JSON.stringify({ mediumUrl, originalUrl })}</script>`,
    );
    const fetchImpl: FetchLike = async (url) => {
      calls.push(url);
      if (url === "https://chatgpt.com/s/m_prefers_original") {
        return makeResponse(200, shareHtml, { "content-type": "text/html; charset=utf-8" });
      }
      return makeResponse(200, PNG_1X1, { "content-type": "image/png" });
    };
    const lookupImpl = stubLookup({ "chatgpt.com": [{ address: "93.184.216.34", family: 4 }] });

    const result = await fetchImageFromUrl("https://chatgpt.com/s/m_prefers_original", { fetchImpl, lookupImpl });

    expect(result.mime).toBe("image/png");
    expect(calls).toEqual(["https://chatgpt.com/s/m_prefers_original", originalUrl]);
  });

  it("falls back when preferred ChatGPT share-page image candidates are unavailable", async () => {
    const originalUrl = chatGptPublicContentUrl("m_share:file_abc123");
    const mediumUrl = chatGptPublicContentUrl("m_share:sediment://two#file_abc123#md");
    const unfurlUrl = chatGptPublicContentUrl("m_share:sediment://one#file_abc123#unfurl");
    const calls: string[] = [];
    const shareHtml = Buffer.from(
      `<!doctype html>
      <meta property="og:image" content="${unfurlUrl}">
      <script>${JSON.stringify({ originalUrl, mediumUrl })}</script>`,
    );
    const fetchImpl: FetchLike = async (url) => {
      calls.push(url);
      if (url === "https://chatgpt.com/s/m_fallback") {
        return makeResponse(200, shareHtml, { "content-type": "text/html; charset=utf-8" });
      }
      if (url === originalUrl || url === mediumUrl) {
        return makeResponse(500, Buffer.from('{"error":"temporarily unavailable"}'), { "content-type": "application/json" });
      }
      return makeResponse(200, PNG_1X1, { "content-type": "image/png" });
    };
    const lookupImpl = stubLookup({ "chatgpt.com": [{ address: "93.184.216.34", family: 4 }] });

    const result = await fetchImageFromUrl("https://chatgpt.com/s/m_fallback", { fetchImpl, lookupImpl });

    expect(result.mime).toBe("image/png");
    expect(calls).toEqual(["https://chatgpt.com/s/m_fallback", originalUrl, mediumUrl, unfurlUrl]);
  });

  it("does not resolve arbitrary non-ChatGPT HTML pages to og:image", async () => {
    const html = Buffer.from('<meta property="og:image" content="https://cdn.example.com/cat.png">');
    const fetchImpl: FetchLike = async () => makeResponse(200, html, { "content-type": "text/html; charset=utf-8" });
    const lookupImpl = stubLookup({ "example.com": [{ address: "93.184.216.34", family: 4 }] });

    await expect(fetchImageFromUrl("https://example.com/share", { fetchImpl, lookupImpl })).rejects.toMatchObject({
      code: ErrorCode.UNSUPPORTED_MEDIA_TYPE,
    });
  });
});

describe("fetchImageFromUrl — SSRF hardening", () => {
  const fetchShouldNotBeCalled: FetchLike = async () => {
    throw new Error("fetch should not have been called");
  };

  it("rejects http://127.0.0.1 (literal loopback IP, no DNS needed)", async () => {
    await expect(
      fetchImageFromUrl("http://127.0.0.1/x.png", { fetchImpl: fetchShouldNotBeCalled, lookupImpl: stubLookup({}) }),
    ).rejects.toMatchObject({ code: ErrorCode.PERMISSION_DENIED });
  });

  it("rejects http://169.254.169.254 (cloud metadata)", async () => {
    await expect(
      fetchImageFromUrl("http://169.254.169.254/latest/meta-data", {
        fetchImpl: fetchShouldNotBeCalled,
        lookupImpl: stubLookup({}),
      }),
    ).rejects.toMatchObject({ code: ErrorCode.PERMISSION_DENIED });
  });

  it("rejects http://10.0.0.5 (private range)", async () => {
    await expect(
      fetchImageFromUrl("http://10.0.0.5/x.png", { fetchImpl: fetchShouldNotBeCalled, lookupImpl: stubLookup({}) }),
    ).rejects.toMatchObject({ code: ErrorCode.PERMISSION_DENIED });
  });

  it("rejects file:///etc/passwd (disallowed scheme)", async () => {
    await expect(
      fetchImageFromUrl("file:///etc/passwd", { fetchImpl: fetchShouldNotBeCalled, lookupImpl: stubLookup({}) }),
    ).rejects.toMatchObject({ code: ErrorCode.PERMISSION_DENIED });
  });

  it("rejects a hostname that DNS-resolves to a loopback address (rebinding-style)", async () => {
    const lookupImpl = stubLookup({ "evil.example.com": [{ address: "127.0.0.1", family: 4 }] });
    await expect(
      fetchImageFromUrl("https://evil.example.com/x.png", { fetchImpl: fetchShouldNotBeCalled, lookupImpl }),
    ).rejects.toMatchObject({ code: ErrorCode.PERMISSION_DENIED });
  });

  it("rejects a redirect that lands on 127.0.0.1", async () => {
    const fetchImpl: FetchLike = async () => makeRedirect(302, "http://127.0.0.1:8080/admin");
    const lookupImpl = stubLookup({ "example.com": [{ address: "93.184.216.34", family: 4 }] });

    await expect(
      fetchImageFromUrl("https://example.com/redirect-to-internal", { fetchImpl, lookupImpl }),
    ).rejects.toMatchObject({ code: ErrorCode.PERMISSION_DENIED });
  });

  it("rejects a redirect chain exceeding maxRedirects", async () => {
    let call = 0;
    const fetchImpl: FetchLike = async () => {
      call++;
      return makeRedirect(302, `https://example.com/hop${call}`);
    };
    const lookupImpl = stubLookup({ "example.com": [{ address: "93.184.216.34", family: 4 }] });

    await expect(
      fetchImageFromUrl("https://example.com/start", { fetchImpl, lookupImpl, maxRedirects: 3 }),
    ).rejects.toMatchObject({ code: ErrorCode.PERMISSION_DENIED });
  });

  it("rejects non-image bytes even with an image/png Content-Type header", async () => {
    const fetchImpl: FetchLike = async () => makeResponse(200, Buffer.from("not an image"), { "content-type": "image/png" });
    const lookupImpl = stubLookup({ "example.com": [{ address: "93.184.216.34", family: 4 }] });

    await expect(
      fetchImageFromUrl("https://example.com/fake.png", { fetchImpl, lookupImpl }),
    ).rejects.toMatchObject({ code: ErrorCode.UNSUPPORTED_MEDIA_TYPE });
  });

  it("rejects a body over the byte cap (streamed, aborts before buffering it all)", async () => {
    const big = Buffer.alloc(2048, 1);
    const fetchImpl: FetchLike = async () => makeResponse(200, big, { "content-type": "image/png" });
    const lookupImpl = stubLookup({ "example.com": [{ address: "93.184.216.34", family: 4 }] });

    await expect(
      fetchImageFromUrl("https://example.com/huge.png", { fetchImpl, lookupImpl, maxBytes: 1024 }),
    ).rejects.toMatchObject({ code: ErrorCode.QUOTA_EXCEEDED });
  });

  it("rejects up front via Content-Length header before reading the body", async () => {
    const fetchImpl: FetchLike = async () =>
      makeResponse(200, PNG_1X1, { "content-type": "image/png", "content-length": String(100 * 1024 * 1024) });
    const lookupImpl = stubLookup({ "example.com": [{ address: "93.184.216.34", family: 4 }] });

    await expect(
      fetchImageFromUrl("https://example.com/huge.png", { fetchImpl, lookupImpl, maxBytes: 50 * 1024 * 1024 }),
    ).rejects.toMatchObject({ code: ErrorCode.QUOTA_EXCEEDED });
  });

  it("wraps a DomainError instance check for host-not-resolvable", async () => {
    const lookupImpl = async () => {
      throw new Error("ENOTFOUND");
    };
    await expect(
      fetchImageFromUrl("https://does-not-resolve.invalid/x.png", { fetchImpl: fetchShouldNotBeCalled, lookupImpl }),
    ).rejects.toBeInstanceOf(DomainError);
  });
});
