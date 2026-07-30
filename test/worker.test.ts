import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { app, normalizeNdlItems, scheduled, type Bindings } from "../src/worker";

const migrationPath = fileURLToPath(new URL("../migrations/0001_events.sql", import.meta.url));
const workerPath = fileURLToPath(new URL("../src/worker.tsx", import.meta.url));
const appPath = fileURLToPath(new URL("../public/app.js", import.meta.url));
const serviceWorkerPath = fileURLToPath(new URL("../public/sw.js", import.meta.url));
const stylesPath = fileURLToPath(new URL("../public/styles.css", import.meta.url));
const manifestPath = fileURLToPath(new URL("../public/manifest.webmanifest", import.meta.url));
const sitemapPath = fileURLToPath(new URL("../public/sitemap.xml", import.meta.url));
const robotsPath = fileURLToPath(new URL("../public/robots.txt", import.meta.url));
const ogPath = fileURLToPath(new URL("../public/og.svg", import.meta.url));
const metricsPath = fileURLToPath(new URL("../ops/product-metrics.sql", import.meta.url));
const origin = "https://shiori-dana.yhay81.com";
const session = "a2d0e2f2-66fd-4fd4-8e87-b0ef67ad194a";

const ndlXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:dcndl="http://ndl.go.jp/dcndl/terms/"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <channel>
    <title>国立国会図書館サーチ</title>
    <item>
      <title>こころ</title>
      <link>https://ndlsearch.ndl.go.jp/books/R100000001-I123456789</link>
      <author>夏目漱石 著</author>
      <category>図書</category>
      <dc:creator>夏目, 漱石, 1867-1916</dc:creator>
      <dc:publisher>岩波書店</dc:publisher>
      <dc:date>2024</dc:date>
      <dc:identifier xsi:type="dcndl:ISBN">9784000000000</dc:identifier>
    </item>
    <item>
      <title>こころという雑誌</title>
      <link>https://ndlsearch.ndl.go.jp/books/R100000002-I000000000</link>
      <category>雑誌</category>
    </item>
  </channel>
</rss>`;

let miniflare: Miniflare;
let bindings: Bindings;

const eventRequest = (
  name: string,
  options: {
    body?: string;
    contentLength?: number;
    contentType?: string;
    origin?: string;
    qa?: boolean;
    session?: string;
  } = {},
) => {
  const body = options.body ?? JSON.stringify({ name });
  return {
    body,
    headers: {
      "content-length": String(options.contentLength ?? new TextEncoder().encode(body).byteLength),
      "content-type": options.contentType ?? "application/json",
      origin: options.origin ?? origin,
      "x-shiori-qa": options.qa ? "1" : "0",
      "x-shiori-session": options.session ?? session,
    },
    method: "POST",
  };
};

const searchRequest = (
  body: string,
  options: { contentLength?: number; contentType?: string; origin?: string } = {},
) => ({
  body,
  headers: {
    "content-length": String(options.contentLength ?? new TextEncoder().encode(body).byteLength),
    "content-type": options.contentType ?? "application/json",
    origin: options.origin ?? origin,
  },
  method: "POST",
});

beforeEach(async () => {
  miniflare = new Miniflare({
    d1Databases: { DB: "shiori-dana-test" },
    modules: true,
    script: "export default { fetch() { return new Response('test') } }",
  });
  const database = await miniflare.getD1Database("DB");
  const migration = await readFile(migrationPath, "utf8");
  for (const statement of migration
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)) {
    await database.prepare(statement).run();
  }
  bindings = {
    ASSETS: { fetch: async () => new Response("asset", { status: 200 }) } as unknown as Fetcher,
    DB: database as unknown as D1Database,
  };
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await miniflare.dispose();
});

describe("public pages", () => {
  it.each([
    ["/", 'class="shelf-scene"', "https://shiori-dana.yhay81.com/"],
    ["/guide", 'class="guide-steps"', "https://shiori-dana.yhay81.com/guide"],
    ["/privacy", 'class="privacy-grid"', "https://shiori-dana.yhay81.com/privacy"],
  ])("%s は製品固有の画面を返す", async (path, marker, canonical) => {
    const response = await app.request(path, undefined, bindings);
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain(marker);
    expect(html).toContain(`href="${canonical}" rel="canonical"`);
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(response.headers.get("permissions-policy")).toContain("camera=()");
    expect(response.headers.get("permissions-policy")).toContain("geolocation=()");
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/i);
    expect(html).not.toMatch(/成功条件|市場スコア|公開実験|収益性|技術選定/);
  });

  it("棚、背表紙、しおり、頁の歩み、持ち出しを画面で示す", async () => {
    const response = await app.request("/", undefined, bindings);
    const html = await response.text();
    expect(html).toContain('class="scene-shelf"');
    expect(html).toContain('class="open-book"');
    expect(html).toContain('class="book-shelf"');
    expect(html).toContain('class="shelf-summary"');
    expect(html).toContain('class="reading-calendar"');
    expect(html).toContain("書名やメモは入れず");
    expect(html).toContain("国立国会図書館サーチAPI");
    expect(html).toMatch(/<script src="\/app\.js" type="module"><\/script>/);
  });

  it("未知のページは製品固有の404を返す", async () => {
    const page = await app.request("/missing", undefined, bindings);
    expect(page.status).toBe(404);
    expect(await page.text()).toContain("その頁には、しおりがありません");
  });

  it("未知のAPIはJSON 404、healthは最小状態を返す", async () => {
    const missing = await app.request("/api/missing", undefined, bindings);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "not_found" });
    const health = await app.request("/health", undefined, bindings);
    expect(health.status).toBe(200);
    expect(health.headers.get("cache-control")).toBe("no-store");
    expect(await health.json()).toEqual({ ok: true });
  });
});

describe("NDL book search", () => {
  it("図書だけを安全な書誌へ正規化する", () => {
    expect(normalizeNdlItems(ndlXml)).toEqual([
      {
        author: "夏目, 漱石, 1867-1916",
        isbn: "9784000000000",
        publishedYear: "2024",
        publisher: "岩波書店",
        title: "こころ",
        url: "https://ndlsearch.ndl.go.jp/books/R100000001-I123456789",
      },
    ]);
  });

  it("書名をPOSTで受け、NDLへだけ転送し、D1へ残さない", async () => {
    const upstream = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      expect(url.origin).toBe("https://ndlsearch.ndl.go.jp");
      expect(url.pathname).toBe("/api/opensearch");
      expect(url.searchParams.get("title")).toBe("こころ");
      expect(url.searchParams.get("cnt")).toBe("12");
      return new Response(ndlXml, { headers: { "content-type": "application/xml" } });
    });
    vi.stubGlobal("fetch", upstream);
    const body = JSON.stringify({ query: "  こころ  " });
    const response = await app.request("/api/books/search", searchRequest(body), bindings);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      books: [{ title: "こころ", isbn: "9784000000000" }],
    });
    expect(upstream).toHaveBeenCalledOnce();
    const row = await bindings.DB.prepare("SELECT COUNT(*) AS count FROM product_events").first<{
      count: number;
    }>();
    expect(row?.count).toBe(0);
  });

  it("ISBNらしい入力はisbnパラメーターにする", async () => {
    const upstream = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      expect(url.searchParams.get("isbn")).toBe("9784000000000");
      expect(url.searchParams.has("title")).toBe(false);
      return new Response(ndlXml);
    });
    vi.stubGlobal("fetch", upstream);
    const body = JSON.stringify({ query: "978-4-0000-0000-0" });
    const response = await app.request("/api/books/search", searchRequest(body), bindings);
    expect(response.status).toBe(200);
  });

  it("本文形、文字数、origin、media type、上流障害を制限する", async () => {
    const validFetch = vi.fn(async () => new Response(ndlXml));
    vi.stubGlobal("fetch", validFetch);
    const extra = JSON.stringify({ query: "こころ", title: "漏えい" });
    expect((await app.request("/api/books/search", searchRequest(extra), bindings)).status).toBe(
      400,
    );
    const short = JSON.stringify({ query: "a" });
    expect((await app.request("/api/books/search", searchRequest(short), bindings)).status).toBe(
      400,
    );
    const crossSite = JSON.stringify({ query: "こころ" });
    expect(
      (
        await app.request(
          "/api/books/search",
          searchRequest(crossSite, { origin: "https://example.com" }),
          bindings,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await app.request(
          "/api/books/search",
          searchRequest("query=x", { contentType: "text/plain" }),
          bindings,
        )
      ).status,
    ).toBe(400);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("error", { status: 503 })),
    );
    const unavailable = await app.request(
      "/api/books/search",
      searchRequest(JSON.stringify({ query: "こころ" })),
      bindings,
    );
    expect(unavailable.status).toBe(502);
    expect(await unavailable.json()).toEqual({ error: "search_unavailable" });
  });
});

describe("anonymous telemetry", () => {
  it.each([
    "visited",
    "book_searched",
    "book_added",
    "progress_updated",
    "book_finished",
    "review_opened",
    "share_card_saved",
    "csv_exported",
    "project_exported",
    "project_imported",
    "returned",
  ])("%s を許可する", async (name) => {
    const response = await app.request("/api/events", eventRequest(name), bindings);
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("イベント名、追加field、セッションIDを許可リストで制限する", async () => {
    expect((await app.request("/api/events", eventRequest("book_title"), bindings)).status).toBe(
      400,
    );
    const content = eventRequest("book_added", {
      body: JSON.stringify({ name: "book_added", title: "こころ" }),
    });
    expect((await app.request("/api/events", content, bindings)).status).toBe(400);
    expect(
      (
        await app.request(
          "/api/events",
          eventRequest("visited", { session: "not-a-session" }),
          bindings,
        )
      ).status,
    ).toBe(400);
  });

  it("JSON以外、不正JSON、宣言または実体が1KB超の本文を拒否する", async () => {
    const media = eventRequest("visited", { contentType: "text/plain" });
    expect((await app.request("/api/events", media, bindings)).status).toBe(400);
    expect(
      (await app.request("/api/events", eventRequest("visited", { body: "{" }), bindings)).status,
    ).toBe(400);
    const oversizedBody = JSON.stringify({ name: "x".repeat(1100) });
    expect(
      (
        await app.request(
          "/api/events",
          eventRequest("visited", { body: oversizedBody, contentLength: 0 }),
          bindings,
        )
      ).status,
    ).toBe(400);
    expect(
      (await app.request("/api/events", eventRequest("visited", { contentLength: 2000 }), bindings))
        .status,
    ).toBe(400);
  });

  it("別originからの記録を拒否する", async () => {
    const response = await app.request(
      "/api/events",
      eventRequest("visited", { origin: "https://example.com" }),
      bindings,
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_event" });
  });

  it("自動QAイベントを実利用から分離する", async () => {
    await app.request("/api/events", eventRequest("book_added", { qa: true }), bindings);
    await app.request("/api/events", eventRequest("book_added"), bindings);
    const rows = await bindings.DB.prepare(
      "SELECT is_qa, COUNT(*) AS count FROM product_events GROUP BY is_qa ORDER BY is_qa",
    ).all<{ count: number; is_qa: number }>();
    expect(rows.results).toEqual([
      { count: 1, is_qa: 0 },
      { count: 1, is_qa: 1 },
    ]);
  });

  it("45日を過ぎた計測だけを削除する", async () => {
    const now = Math.floor(Date.now() / 1000);
    await bindings.DB.prepare(
      `INSERT INTO product_events (name, session_id, day, created_at, is_qa)
       VALUES ('visited', ?, '2026-01-01', ?, 0), ('visited', ?, '2026-07-30', ?, 0)`,
    )
      .bind(session, now - 46 * 86400, session, now)
      .run();
    await scheduled({} as ScheduledController, bindings, {} as ExecutionContext);
    const row = await bindings.DB.prepare("SELECT COUNT(*) AS count FROM product_events").first<{
      count: number;
    }>();
    expect(row?.count).toBe(1);
  });
});

describe("local reading shelf contract", () => {
  it("読書内容はIndexedDBだけに置き、外向き通信を限定する", async () => {
    const source = await readFile(appPath, "utf8");
    expect(source.match(/\bfetch\s*\(/g)).toHaveLength(2);
    expect(source).toContain('fetch("/api/events"');
    expect(source).toContain('fetch("/api/books/search"');
    expect(source).toContain("indexedDB.open");
    expect(source).toContain('createObjectStore("books"');
    expect(source).toContain('createObjectStore("logs"');
    expect(source).toContain('createObjectStore("config"');
    expect(source).toContain("const maximumBooks = 500");
    expect(source).toContain("const maximumLogs = 5000");
    expect(source).not.toMatch(/innerHTML|eval\(|new Function/);
  });

  it("本の状態、現在頁、読了、12週間を扱える", async () => {
    const source = await readFile(appPath, "utf8");
    expect(source).toContain('"reading", "want", "owned", "finished", "paused"');
    expect(source).toContain("currentPage");
    expect(source).toContain('track("progress_updated")');
    expect(source).toContain('track("book_finished")');
    expect(source).toContain("for (let index = 0; index < 84; index += 1)");
  });

  it("共有画像から内容を除外し、CSV式を無害化する", async () => {
    const [source, worker] = await Promise.all([
      readFile(appPath, "utf8"),
      readFile(workerPath, "utf8"),
    ]);
    expect(source).toContain("toBlob((blob)");
    expect(source).toContain(".shiori");
    expect(source).toContain("text/csv");
    expect(source).toContain("/^[=+\\-@\\t\\r]/");
    expect(worker).toContain("書名やメモは入れず");
    expect(source).not.toContain("book.title, 72");
  });

  it("読み込み前に形式、上限、UUID、参照、値域を検証する", async () => {
    const source = await readFile(appPath, "utf8");
    expect(source).toContain('project.format !== "shiori-dana"');
    expect(source).toContain("project.books.length > maximumBooks");
    expect(source).toContain("project.logs.length > maximumLogs");
    expect(source).toContain("validImportedBook");
    expect(source).toContain("validImportedLog");
    expect(source).toContain("bookIds.size !== project.books.length");
    expect(source).toContain("hasOnlyKeys");
  });

  it("静的製品面をネットワーク優先でキャッシュし、APIを除外する", async () => {
    const source = await readFile(serviceWorkerPath, "utf8");
    expect(source).toContain('const cacheName = "shiori-dana-v1"');
    expect(source).toContain("caches.open");
    expect(source).toContain("fetch(event.request)");
    expect(source).toContain('!event.request.url.includes("/api/")');
  });

  it("巨大文字に頼らず、棚の視覚要素をレスポンシブにする", async () => {
    const source = await readFile(stylesPath, "utf8");
    expect(source).toContain("clamp(1.75rem, 3.2vw, 2rem)");
    expect(source).toContain(".shelf-scene");
    expect(source).toContain(".scene-shelf");
    expect(source).toContain(".book-cover");
    expect(source).toContain(".reading-calendar");
    expect(source).toContain("@media (max-width: 760px)");
    expect(source).not.toMatch(/h1\s*\{[^}]*font-size:\s*(?:[4-9]\d|[1-9]\d{2})px/s);
  });
});

describe("metrics contract", () => {
  it("冊数、更新日数、利用期間を測り、QAを除く", async () => {
    const source = await readFile(metricsPath, "utf8");
    expect(source).toContain("WHERE is_qa = 0");
    expect(source).toContain("books_added >= 5");
    expect(source).toContain("update_days >= 3");
    expect(source).toContain("span_days >= 7");
    expect(source).toContain("name = 'progress_updated'");
  });
});

describe("discovery assets", () => {
  it("manifestは栞棚のPWA情報を持つ", async () => {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
    expect(manifest.name).toBe("栞棚");
    expect(manifest.description).toContain("読了日");
    expect(manifest.start_url).toBe("/");
    expect(manifest.display).toBe("standalone");
    expect(manifest.theme_color).toBe("#f1eadc");
    expect(manifest.icons).toHaveLength(1);
  });

  it("sitemapとrobotsはshiori-dana.yhay81.comを指す", async () => {
    const [sitemap, robots] = await Promise.all([
      readFile(sitemapPath, "utf8"),
      readFile(robotsPath, "utf8"),
    ]);
    expect(sitemap.match(/<loc>/g)).toHaveLength(3);
    expect(sitemap).toContain("https://shiori-dana.yhay81.com/guide");
    expect(robots).toContain("https://shiori-dana.yhay81.com/sitemap.xml");
  });

  it("OG画像は棚、本、しおり、開いた頁で製品を示す", async () => {
    const source = await readFile(ogPath, "utf8");
    expect(source.length).toBeGreaterThan(2500);
    expect(source).toContain("読んだ頁を、棚に残す");
    expect(source).toContain("端末内保存");
    expect(source).toContain("shiori-dana.yhay81.com");
    expect(source).not.toContain("PRIVATE STUDY DESK");
  });
});
