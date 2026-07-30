/** @jsxImportSource hono/jsx */
import { XMLParser } from "fast-xml-parser";
import { Hono } from "hono";
import { html } from "hono/html";
import { jsxRenderer } from "hono/jsx-renderer";
import type { Child } from "hono/jsx";
import { secureHeaders } from "hono/secure-headers";

export type Bindings = {
  ASSETS: Fetcher;
  DB: D1Database;
};

type Variables = {
  requestId: string;
};

type BookResult = {
  title: string;
  author: string;
  publisher: string;
  publishedYear: string;
  isbn: string;
  url: string;
};

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();
const canonicalOrigin = "https://shiori-dana.yhay81.com";
const ndlOrigin = "https://ndlsearch.ndl.go.jp";
const eventLifetime = 45 * 86400;
const eventNames = new Set([
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
]);
const sessionPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const requestIdPattern = /^[0-9a-f-]{36}$/i;
const allowedOrigins = new Set([canonicalOrigin]);

const nowSeconds = () => Math.floor(Date.now() / 1000);

const containsControlCharacter = (value: string) =>
  Array.from(value).some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || code === 127;
  });

const singleLine = (value: unknown, maximum: number) =>
  typeof value === "string" && !containsControlCharacter(value) && value.length <= maximum;

const parseSmallJson = async (request: Request, maximum = 1024): Promise<unknown> => {
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > maximum) throw new Error("body_too_large");
  return JSON.parse(raw);
};

const textValue = (value: unknown): string => {
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (value && typeof value === "object" && "#text" in value) {
    const text = (value as { "#text"?: unknown })["#text"];
    return typeof text === "string" || typeof text === "number" ? String(text).trim() : "";
  }
  return "";
};

const arrayValue = <T,>(value: T | T[] | undefined): T[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

const firstText = (value: unknown) =>
  arrayValue(value as unknown | unknown[])
    .map(textValue)
    .find(Boolean) ?? "";

const isbnFromIdentifiers = (value: unknown) => {
  for (const identifier of arrayValue(value as unknown | unknown[])) {
    const text = textValue(identifier).replace(/[^0-9X]/gi, "");
    const attributes =
      identifier && typeof identifier === "object"
        ? Object.entries(identifier as Record<string, unknown>)
            .filter(([key]) => key.startsWith("@_"))
            .map(([, entry]) => String(entry))
            .join(" ")
        : "";
    if (/ISBN/i.test(attributes) && /^(?:\d{9}[\dX]|\d{13})$/i.test(text)) return text;
  }
  return "";
};

const normalizeNdlItems = (xml: string): BookResult[] => {
  const parser = new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
    trimValues: true,
  });
  const parsed = parser.parse(xml) as {
    rss?: {
      channel?: {
        item?: unknown | unknown[];
      };
    };
  };
  const items = arrayValue(parsed.rss?.channel?.item);
  const results: BookResult[] = [];

  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const categories = arrayValue(item.category).map(textValue).filter(Boolean);
    const title = firstText(item.title);
    const link = firstText(item.link);
    let url = "";
    try {
      const candidate = new URL(link);
      if (candidate.protocol === "https:" && candidate.hostname === "ndlsearch.ndl.go.jp") {
        url = candidate.href;
      }
    } catch {
      // A source link is optional; invalid external links are never returned.
    }
    if (!title || (categories.length > 0 && !categories.some((value) => value.includes("図書")))) {
      continue;
    }
    const author = firstText(item.creator) || firstText(item.author);
    const publisher = firstText(item.publisher);
    const date = firstText(item.date);
    results.push({
      title: title.slice(0, 200),
      author: author.slice(0, 160),
      publisher: publisher.slice(0, 160),
      publishedYear: date.match(/\d{4}/)?.[0] ?? "",
      isbn: isbnFromIdentifiers(item.identifier),
      url,
    });
    if (results.length >= 12) break;
  }
  return results;
};

const searchNdl = async (query: string): Promise<BookResult[]> => {
  const compact = query.trim().replace(/\s+/g, " ");
  const isbn = compact.replace(/[^0-9X]/gi, "");
  const parameters = new URLSearchParams({ cnt: "12" });
  if (/^(?:\d{9}[\dX]|\d{13})$/i.test(isbn)) parameters.set("isbn", isbn);
  else parameters.set("title", compact);

  const upstream = await fetch(`${ndlOrigin}/api/opensearch?${parameters.toString()}`, {
    headers: { accept: "application/xml, text/xml;q=0.9" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!upstream.ok) throw new Error(`NDL returned ${upstream.status}`);
  const xml = await upstream.text();
  if (xml.length > 2_000_000) throw new Error("NDL response too large");
  return normalizeNdlItems(xml);
};

const Logo = () => (
  <span class="logo-mark" aria-hidden="true">
    <span class="logo-book"></span>
    <span class="logo-ribbon"></span>
  </span>
);

const ShelfScene = () => (
  <div class="shelf-scene" aria-label="しおりの挟まった本が並ぶ木の棚">
    <div class="sun-patch"></div>
    <div class="wall-frame">
      <span></span>
      <span></span>
      <span></span>
    </div>
    <div class="plant">
      <i></i>
      <i></i>
      <i></i>
      <b></b>
    </div>
    <div class="scene-shelf">
      <span class="spine ochre tall"></span>
      <span class="spine cream"></span>
      <span class="spine green tall"></span>
      <span class="spine rust"></span>
      <span class="spine blue tall">
        <i></i>
      </span>
      <span class="spine rose"></span>
      <span class="book-stack"></span>
    </div>
    <div class="open-book">
      <span class="page left"></span>
      <span class="page right"></span>
      <span class="page-line l1"></span>
      <span class="page-line l2"></span>
      <span class="page-line l3"></span>
      <span class="open-ribbon"></span>
    </div>
    <div class="scene-note">
      <span>12</span>
      <small>頁</small>
    </div>
  </div>
);

const Layout = (props: { children: Child; title: string; description: string; path?: string }) => {
  const url = `${canonicalOrigin}${props.path ?? "/"}`;
  return (
    <html lang="ja">
      <head>
        <meta charset="utf-8" />
        <meta content="width=device-width, initial-scale=1" name="viewport" />
        <meta content="#f1eadc" name="theme-color" />
        <meta content={props.description} name="description" />
        <meta content="website" property="og:type" />
        <meta content={props.title} property="og:title" />
        <meta content={props.description} property="og:description" />
        <meta content={`${canonicalOrigin}/og.svg`} property="og:image" />
        <meta
          content="木の棚に本が並び、開いた本にしおりが挟まった栞棚の画面"
          property="og:image:alt"
        />
        <meta content={url} property="og:url" />
        <meta content="栞棚" property="og:site_name" />
        <meta content="summary_large_image" name="twitter:card" />
        <link href={url} rel="canonical" />
        <link href="/favicon.svg" rel="icon" type="image/svg+xml" />
        <link href="/manifest.webmanifest" rel="manifest" />
        <link href="/styles.css" rel="stylesheet" />
        <title>{props.title}</title>
      </head>
      <body>
        <a class="skip-link" href="#main">
          本文へ移動
        </a>
        <header class="site-header">
          <a class="brand" href="/" aria-label="栞棚 ホーム">
            <Logo />
            <span>栞棚</span>
          </a>
          <nav aria-label="ページ">
            <a href="/guide">使い方</a>
            <a href="/privacy">保存先</a>
          </nav>
        </header>
        {props.children}
        <footer>
          <a class="footer-brand" href="/">
            <Logo />
            <span>栞棚</span>
          </a>
          <p>読んだ頁を、自分の棚に。</p>
          <nav aria-label="フッター">
            <a href="/guide">使い方</a>
            <a href="/privacy">保存先とプライバシー</a>
            <a href="https://github.com/yhay81/shiori-dana">GitHub</a>
          </nav>
        </footer>
        <script src="/app.js" type="module"></script>
      </body>
    </html>
  );
};

const BookForm = () => (
  <form class="book-form" data-book-form>
    <input name="id" type="hidden" />
    <div class="form-grid">
      <label class="span-two">
        <span>書名</span>
        <input maxLength={200} name="title" required />
      </label>
      <label>
        <span>著者</span>
        <input maxLength={160} name="author" />
      </label>
      <label>
        <span>ISBN</span>
        <input inputmode="numeric" maxLength={20} name="isbn" />
      </label>
      <label>
        <span>出版社</span>
        <input maxLength={160} name="publisher" />
      </label>
      <label>
        <span>出版年</span>
        <input inputmode="numeric" maxLength={4} name="publishedYear" pattern="[0-9]{4}" />
      </label>
      <label>
        <span>棚</span>
        <select name="state">
          <option value="want">読みたい</option>
          <option value="owned">積んでいる</option>
          <option value="reading">読んでいる</option>
          <option value="finished">読了</option>
          <option value="paused">ひと休み</option>
        </select>
      </label>
      <label>
        <span>総頁数</span>
        <input inputmode="numeric" max="100000" min="1" name="totalPages" type="number" />
      </label>
      <label>
        <span>シリーズ</span>
        <input maxLength={120} name="series" />
      </label>
      <label>
        <span>巻</span>
        <input maxLength={40} name="volume" />
      </label>
      <label class="span-two">
        <span>タグ</span>
        <input maxLength={160} name="tags" placeholder="小説, 仕事（カンマ区切り）" />
      </label>
      <label class="span-two">
        <span>自分だけのメモ</span>
        <textarea maxLength={4000} name="note" rows={4}></textarea>
      </label>
      <label>
        <span>読み始め</span>
        <input name="startedOn" type="date" />
      </label>
      <label>
        <span>読了日</span>
        <input name="finishedOn" type="date" />
      </label>
      <label>
        <span>評価</span>
        <select name="rating">
          <option value="">つけない</option>
          <option value="1">★</option>
          <option value="2">★★</option>
          <option value="3">★★★</option>
          <option value="4">★★★★</option>
          <option value="5">★★★★★</option>
        </select>
      </label>
      <label>
        <span>再読回数</span>
        <input inputmode="numeric" max="99" min="0" name="rereadCount" type="number" value="0" />
      </label>
    </div>
    <p class="form-state" data-book-form-state aria-live="polite"></p>
    <div class="dialog-actions">
      <button class="quiet-button" data-close-dialog type="button">
        閉じる
      </button>
      <button class="primary-button" type="submit">
        棚に置く
      </button>
    </div>
  </form>
);

const ProgressForm = () => (
  <form class="progress-form" data-progress-form>
    <input name="bookId" type="hidden" />
    <div class="progress-book">
      <span class="mini-spine" data-progress-spine></span>
      <div>
        <small>読んでいる本</small>
        <strong data-progress-title></strong>
      </div>
    </div>
    <label>
      <span>いまの頁</span>
      <div class="page-input">
        <input inputmode="numeric" max="100000" min="0" name="currentPage" required type="number" />
        <span data-progress-total>頁</span>
      </div>
    </label>
    <label>
      <span>ひとこと（任意）</span>
      <textarea maxLength={500} name="memo" rows={3}></textarea>
    </label>
    <label class="finish-check">
      <input name="finish" type="checkbox" />
      <span>この本を読了にする</span>
    </label>
    <p class="form-state" data-progress-state aria-live="polite"></p>
    <div class="dialog-actions">
      <button class="quiet-button" data-close-dialog type="button">
        閉じる
      </button>
      <button class="primary-button" type="submit">
        しおりを挟む
      </button>
    </div>
  </form>
);

const Home = () => (
  <Layout
    description="読みたい本、読んでいる頁、読了日、私的な感想を、公開せず端末内の棚へ残す読書台帳。登録なしで使えます。"
    title="栞棚｜読んだ頁を、自分の棚に"
  >
    <main id="main">
      <section class="hero">
        <div class="hero-copy">
          <p class="eyebrow">自分だけの読書棚</p>
          <h1>読んだ頁を、棚に残す。</h1>
          <p>
            読みたい本も、途中の頁も、読み終えた日も。
            <br />
            公開せず、この端末に並べられます。
          </p>
          <div class="hero-actions">
            <button class="primary-button" data-action="open-search" type="button">
              本を探す
            </button>
            <button class="quiet-button" data-action="open-manual" type="button">
              手入力で置く
            </button>
          </div>
          <ul class="trust-row" aria-label="特徴">
            <li>
              <span class="trust-dot"></span>登録なし
            </li>
            <li>
              <span class="trust-dot"></span>本棚は端末内
            </li>
            <li>
              <span class="trust-dot"></span>持ち出せる
            </li>
          </ul>
        </div>
        <ShelfScene />
      </section>

      <section class="library" data-library>
        <div class="library-toolbar">
          <div>
            <p class="section-kicker">MY SHELF</p>
            <h2>わたしの棚</h2>
          </div>
          <div class="toolbar-actions">
            <button class="icon-button" data-action="open-review" title="読書の歩み" type="button">
              <span aria-hidden="true">▦</span>
              <span>歩み</span>
            </button>
            <button
              class="icon-button"
              data-action="open-data"
              title="保存と持ち出し"
              type="button"
            >
              <span aria-hidden="true">⇩</span>
              <span>保存</span>
            </button>
          </div>
        </div>

        <div class="shelf-summary" aria-live="polite">
          <div class="summary-tile reading">
            <span class="summary-icon">▥</span>
            <div>
              <strong data-reading-count>0</strong>
              <small>読んでいる</small>
            </div>
          </div>
          <div class="summary-tile finished">
            <span class="summary-icon">✓</span>
            <div>
              <strong data-finished-count>0</strong>
              <small>読み終えた</small>
            </div>
          </div>
          <div class="summary-tile pages">
            <span class="summary-icon">⌁</span>
            <div>
              <strong data-page-count>0</strong>
              <small>記録した頁</small>
            </div>
          </div>
          <div class="summary-tile streak">
            <span class="summary-icon">⌇</span>
            <div>
              <strong data-reading-days>0</strong>
              <small>読書した日</small>
            </div>
          </div>
        </div>

        <div class="filter-strip" role="group" aria-label="棚を絞り込む">
          <button aria-pressed="true" data-filter="all" type="button">
            すべて
          </button>
          <button aria-pressed="false" data-filter="reading" type="button">
            読んでいる
          </button>
          <button aria-pressed="false" data-filter="want" type="button">
            読みたい
          </button>
          <button aria-pressed="false" data-filter="owned" type="button">
            積んでいる
          </button>
          <button aria-pressed="false" data-filter="finished" type="button">
            読了
          </button>
          <button aria-pressed="false" data-filter="paused" type="button">
            ひと休み
          </button>
        </div>

        <div class="book-shelf" data-book-shelf></div>
        <div class="empty-shelf" data-empty-shelf>
          <div class="empty-books" aria-hidden="true">
            <span></span>
            <span></span>
            <span></span>
            <i></i>
          </div>
          <h3>最初の一冊を置きましょう</h3>
          <p>書名やISBNから探すか、そのまま手入力できます。</p>
          <div>
            <button class="primary-button small" data-action="open-search" type="button">
              本を探す
            </button>
            <button class="text-button" data-action="open-list-import" type="button">
              書名をまとめて貼る
            </button>
          </div>
        </div>
        <button class="shelf-add" data-action="open-search" type="button">
          <span aria-hidden="true">＋</span>
          本を置く
        </button>
      </section>
    </main>

    <dialog class="search-dialog" data-search-dialog>
      <div class="dialog-heading">
        <div>
          <p class="section-kicker">FIND A BOOK</p>
          <h2>本を探す</h2>
        </div>
        <button aria-label="閉じる" class="dialog-close" data-close-dialog type="button">
          ×
        </button>
      </div>
      <form class="search-form" data-search-form>
        <label>
          <span>書名またはISBN</span>
          <div class="search-field">
            <input
              autocomplete="off"
              maxLength={120}
              name="query"
              placeholder="例：こころ"
              required
            />
            <button class="primary-button" type="submit">
              探す
            </button>
          </div>
        </label>
      </form>
      <p class="search-state" data-search-state aria-live="polite">
        書名かISBNを入力してください。
      </p>
      <div class="search-results" data-search-results></div>
      <div class="search-foot">
        <p>
          書誌検索は
          <a href="https://ndlsearch.ndl.go.jp/help/api" rel="noreferrer" target="_blank">
            国立国会図書館サーチAPI
          </a>
          を使用しています。
        </p>
        <button class="text-button" data-action="open-manual" type="button">
          見つからない本を手入力
        </button>
      </div>
    </dialog>

    <dialog data-book-dialog>
      <div class="dialog-heading">
        <div>
          <p class="section-kicker">BOOK CARD</p>
          <h2 data-book-dialog-title>本を棚に置く</h2>
        </div>
        <button aria-label="閉じる" class="dialog-close" data-close-dialog type="button">
          ×
        </button>
      </div>
      <BookForm />
    </dialog>

    <dialog class="progress-dialog" data-progress-dialog>
      <div class="dialog-heading">
        <div>
          <p class="section-kicker">BOOKMARK</p>
          <h2>しおりを挟む</h2>
        </div>
        <button aria-label="閉じる" class="dialog-close" data-close-dialog type="button">
          ×
        </button>
      </div>
      <ProgressForm />
    </dialog>

    <dialog class="review-dialog" data-review-dialog>
      <div class="dialog-heading">
        <div>
          <p class="section-kicker">READING TRAIL</p>
          <h2>読書の歩み</h2>
        </div>
        <button aria-label="閉じる" class="dialog-close" data-close-dialog type="button">
          ×
        </button>
      </div>
      <div class="review-grid">
        <section class="calendar-card">
          <div class="card-heading">
            <h3>12週間の頁</h3>
            <span data-calendar-total>0頁</span>
          </div>
          <div class="reading-calendar" data-reading-calendar></div>
          <div class="calendar-legend">
            <span>少</span>
            <i data-level="0"></i>
            <i data-level="1"></i>
            <i data-level="2"></i>
            <i data-level="3"></i>
            <i data-level="4"></i>
            <span>多</span>
          </div>
        </section>
        <section class="recent-card">
          <div class="card-heading">
            <h3>最近のしおり</h3>
          </div>
          <div class="recent-log-list" data-recent-logs></div>
          <p class="quiet-empty" data-log-empty>
            頁を記録すると、ここに並びます。
          </p>
        </section>
      </div>
      <section class="share-section">
        <div>
          <h3>読書の歩みを画像に</h3>
          <p>書名やメモは入れず、冊数と頁数だけで作ります。</p>
        </div>
        <button class="quiet-button" data-action="save-share-card" type="button">
          画像を保存
        </button>
        <canvas data-share-canvas height="630" hidden width="1200"></canvas>
      </section>
    </dialog>

    <dialog class="data-dialog" data-data-dialog>
      <div class="dialog-heading">
        <div>
          <p class="section-kicker">PORTABLE SHELF</p>
          <h2>保存と持ち出し</h2>
        </div>
        <button aria-label="閉じる" class="dialog-close" data-close-dialog type="button">
          ×
        </button>
      </div>
      <div class="data-cards">
        <article>
          <span class="data-icon">CSV</span>
          <div>
            <h3>表として読む</h3>
            <p>本と現在の頁をCSVにまとめます。</p>
          </div>
          <button class="quiet-button" data-action="export-csv" type="button">
            CSVを保存
          </button>
        </article>
        <article>
          <span class="data-icon">栞</span>
          <div>
            <h3>棚をまるごと保管</h3>
            <p>本、しおり、メモを編集用ファイルへ。</p>
          </div>
          <button class="quiet-button" data-action="export-project" type="button">
            .shioriを保存
          </button>
        </article>
        <article>
          <span class="data-icon">↥</span>
          <div>
            <h3>保管した棚を戻す</h3>
            <p>現在の棚を置き換えます。先に保存してください。</p>
          </div>
          <label class="quiet-button file-button">
            .shioriを選ぶ
            <input accept=".shiori,application/json" data-import-file type="file" />
          </label>
        </article>
      </div>
      <p class="form-state" data-data-state aria-live="polite"></p>
    </dialog>

    <dialog class="list-dialog" data-list-dialog>
      <div class="dialog-heading">
        <div>
          <p class="section-kicker">QUICK SHELF</p>
          <h2>書名をまとめて置く</h2>
        </div>
        <button aria-label="閉じる" class="dialog-close" data-close-dialog type="button">
          ×
        </button>
      </div>
      <form data-list-form>
        <label>
          <span>一行に一冊</span>
          <textarea
            maxLength={20000}
            name="titles"
            placeholder={"銀河鉄道の夜\nこころ\n檸檬"}
            required
            rows={10}
          ></textarea>
        </label>
        <p>最大100冊。「読みたい」棚へ置きます。著者などは後から編集できます。</p>
        <p class="form-state" data-list-state aria-live="polite"></p>
        <div class="dialog-actions">
          <button class="quiet-button" data-close-dialog type="button">
            閉じる
          </button>
          <button class="primary-button" type="submit">
            まとめて置く
          </button>
        </div>
      </form>
    </dialog>

    <noscript>
      <p class="noscript">栞棚を使うにはJavaScriptを有効にしてください。</p>
    </noscript>
  </Layout>
);

const Guide = () => (
  <Layout
    description="栞棚で本を探し、棚に置き、読んだ頁を記録し、データを手元へ保存する方法。"
    path="/guide"
    title="使い方｜栞棚"
  >
    <main class="subpage" id="main">
      <header class="subpage-lead">
        <p class="eyebrow">使い方</p>
        <h1>本を置き、しおりを挟む。</h1>
        <p>アカウントを作らず、三つの動作で読書の棚が育ちます。</p>
      </header>
      <ol class="guide-steps">
        <li>
          <div class="step-visual find">
            <span class="search-glass"></span>
            <span class="found-spine"></span>
          </div>
          <div>
            <span class="step-number">01</span>
            <h2>本を見つける</h2>
            <p>
              書名かISBNで国立国会図書館サーチを検索します。見つからない本は手入力でき、書名だけをまとめて貼ることもできます。
            </p>
          </div>
        </li>
        <li>
          <div class="step-visual bookmark">
            <span class="guide-book"></span>
            <span class="guide-ribbon"></span>
          </div>
          <div>
            <span class="step-number">02</span>
            <h2>頁にしおりを挟む</h2>
            <p>
              本の「しおり」から現在の頁を記録します。読了にすると日付も残り、12週間の歩みへ色が灯ります。
            </p>
          </div>
        </li>
        <li>
          <div class="step-visual carry">
            <span class="file-sheet"></span>
            <span class="carry-arrow">↓</span>
          </div>
          <div>
            <span class="step-number">03</span>
            <h2>棚を手元に保管する</h2>
            <p>
              ブラウザーのデータを消す前や端末を替える前に、保存画面から
              <code>.shiori</code> ファイルを保管してください。CSVでも読めます。
            </p>
          </div>
        </li>
      </ol>
      <aside class="guide-note">
        <Logo />
        <div>
          <h2>続きは同じブラウザーで</h2>
          <p>棚はこの端末のこのブラウザーにあります。同期や会員登録はありません。</p>
        </div>
        <a class="primary-button small" href="/">
          棚を開く
        </a>
      </aside>
    </main>
  </Layout>
);

const Privacy = () => (
  <Layout
    description="栞棚が端末内に保存する読書記録、国立国会図書館サーチへの検索、内容を含まない匿名利用計測の説明。"
    path="/privacy"
    title="保存先とプライバシー｜栞棚"
  >
    <main class="subpage" id="main">
      <header class="subpage-lead">
        <p class="eyebrow">保存先とプライバシー</p>
        <h1>読書の中身は、端末の中。</h1>
        <p>書名、頁、評価、メモを栞棚のサーバーへ保存することはありません。</p>
      </header>
      <div class="privacy-grid">
        <article>
          <span class="privacy-symbol device">▣</span>
          <h2>端末に残るもの</h2>
          <p>
            本の情報、状態、現在頁、読書日、評価、タグ、メモは、ブラウザーのIndexedDBに保存します。
          </p>
        </article>
        <article>
          <span class="privacy-symbol network">⌕</span>
          <h2>検索時だけ送るもの</h2>
          <p>
            本を検索すると、入力した書名またはISBNを国立国会図書館サーチAPIへ送ります。栞棚の計測DBには保存しません。
          </p>
        </article>
        <article>
          <span class="privacy-symbol measure">•••</span>
          <h2>匿名で数えるもの</h2>
          <p>
            「本を追加した」など、内容を含まない操作名、匿名の端末内ID、日付だけを45日間保持します。書名・ISBN・頁数・メモは送りません。
          </p>
        </article>
        <article>
          <span class="privacy-symbol export">⇩</span>
          <h2>自分で持ち出すもの</h2>
          <p>
            CSVと<code>.shiori</code>
            は、操作したときだけ端末へ保存します。共有画像は書名やメモを含めず、冊数と頁数だけで作ります。
          </p>
        </article>
      </div>
      <section class="privacy-details">
        <h2>知っておいてほしいこと</h2>
        <ul>
          <li>Cookie、広告SDK、外部アクセス解析、会員アカウントは使いません。</li>
          <li>別の端末やブラウザーへ自動同期されません。</li>
          <li>ブラウザーのサイトデータを消すと棚も消えます。定期的な保存をおすすめします。</li>
          <li>検索結果の書誌情報は国立国会図書館サーチから取得し、表紙画像は取得しません。</li>
        </ul>
      </section>
    </main>
  </Layout>
);

app.use(
  "*",
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
    },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: "same-origin",
    crossOriginResourcePolicy: "same-origin",
    referrerPolicy: "no-referrer",
    strictTransportSecurity: "max-age=31536000; includeSubDomains",
    xContentTypeOptions: "nosniff",
    xFrameOptions: "DENY",
  }),
);

app.use("*", async (c, next) => {
  const incoming = c.req.header("cf-ray")?.split("-")[0] ?? "";
  c.set("requestId", requestIdPattern.test(incoming) ? incoming : crypto.randomUUID());
  await next();
  c.header("Permissions-Policy", "camera=(), geolocation=(), microphone=(), payment=()");
  c.header("X-Request-Id", c.get("requestId"));
  if (c.req.path.startsWith("/api/")) c.header("Cache-Control", "no-store");
});

app.use(
  "*",
  jsxRenderer(({ children }) => html`${children}`),
);

app.get("/", (c) => c.render(<Home />));
app.get("/guide", (c) => c.render(<Guide />));
app.get("/privacy", (c) => c.render(<Privacy />));
app.get("/health", (c) => {
  c.header("Cache-Control", "no-store");
  return c.json({ ok: true });
});

app.post("/api/books/search", async (c) => {
  const origin = c.req.header("origin");
  const contentType = c.req.header("content-type") ?? "";
  const contentLength = Number(c.req.header("content-length") ?? "0");
  if (
    (origin && !allowedOrigins.has(origin)) ||
    !contentType.toLowerCase().startsWith("application/json") ||
    !Number.isFinite(contentLength) ||
    contentLength > 1024
  ) {
    return c.json({ error: "invalid_request" }, 400);
  }

  let body: unknown;
  try {
    body = await parseSmallJson(c.req.raw);
  } catch {
    return c.json({ error: "invalid_request" }, 400);
  }
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).length !== 1 ||
    !("query" in body)
  ) {
    return c.json({ error: "invalid_request" }, 400);
  }
  const query = (body as { query?: unknown }).query;
  if (!singleLine(query, 120) || String(query).trim().length < 2) {
    return c.json({ error: "invalid_query" }, 400);
  }

  try {
    return c.json({ books: await searchNdl(String(query)) });
  } catch {
    return c.json({ error: "search_unavailable" }, 502);
  }
});

app.post("/api/events", async (c) => {
  const origin = c.req.header("origin");
  const contentType = c.req.header("content-type") ?? "";
  const contentLength = Number(c.req.header("content-length") ?? "0");
  if (
    (origin && !allowedOrigins.has(origin)) ||
    !contentType.toLowerCase().startsWith("application/json") ||
    !Number.isFinite(contentLength) ||
    contentLength > 1024
  ) {
    return c.json({ error: "invalid_event" }, 400);
  }

  let body: unknown;
  try {
    body = await parseSmallJson(c.req.raw);
  } catch {
    return c.json({ error: "invalid_event" }, 400);
  }
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).length !== 1 ||
    !("name" in body)
  ) {
    return c.json({ error: "invalid_event" }, 400);
  }

  const name = (body as { name?: unknown }).name;
  const sessionId = c.req.header("x-shiori-session") ?? "";
  if (
    typeof name !== "string" ||
    !eventNames.has(name) ||
    !sessionPattern.test(sessionId) ||
    !singleLine(name, 64)
  ) {
    return c.json({ error: "invalid_event" }, 400);
  }

  const timestamp = nowSeconds();
  await c.env.DB.prepare(
    `INSERT INTO product_events (name, session_id, day, created_at, is_qa)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(
      name,
      sessionId.toLowerCase(),
      new Date(timestamp * 1000).toISOString().slice(0, 10),
      timestamp,
      c.req.header("x-shiori-qa") === "1" ? 1 : 0,
    )
    .run();
  return c.json({ ok: true }, 202);
});

app.notFound((c) => {
  if (c.req.path.startsWith("/api/")) return c.json({ error: "not_found" }, 404);
  c.status(404);
  return c.render(
    <Layout
      description="お探しのページは栞棚にありません。"
      path={c.req.path}
      title="見つかりません｜栞棚"
    >
      <main class="not-found" id="main">
        <ShelfScene />
        <div>
          <p class="eyebrow">404</p>
          <h1>その頁には、しおりがありません。</h1>
          <p>棚へ戻って、続きを開きましょう。</p>
          <a class="primary-button small" href="/">
            棚へ戻る
          </a>
        </div>
      </main>
    </Layout>,
  );
});

const scheduled: ExportedHandlerScheduledHandler<Bindings> = async (_event, env) => {
  await env.DB.prepare("DELETE FROM product_events WHERE created_at <= ?")
    .bind(nowSeconds() - eventLifetime)
    .run();
};

export { app, eventNames, normalizeNdlItems, scheduled };

export default {
  fetch: app.fetch,
  scheduled,
} satisfies ExportedHandler<Bindings>;
