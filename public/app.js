const databaseName = "shiori-dana";
const databaseVersion = 1;
const maximumBooks = 500;
const maximumLogs = 5000;
const maximumListImport = 100;
const sessionKey = "shiori-dana-session";
const visitKey = "shiori-dana-last-visit";
const filterKey = "shiori-dana-filter";
const stateLabels = {
  want: "読みたい",
  owned: "積んでいる",
  reading: "読んでいる",
  finished: "読了",
  paused: "ひと休み",
};
const stateOrder = ["reading", "want", "owned", "finished", "paused"];
const spineClasses = ["ochre", "green", "rust", "blue", "rose", "plum", "sand", "teal"];

/** @typedef {"want" | "owned" | "reading" | "finished" | "paused"} BookState */
/**
 * @typedef {object} Book
 * @property {string} id
 * @property {string} title
 * @property {string} author
 * @property {string} isbn
 * @property {string} publisher
 * @property {string} publishedYear
 * @property {BookState} state
 * @property {number | null} totalPages
 * @property {number} currentPage
 * @property {string} series
 * @property {string} volume
 * @property {string[]} tags
 * @property {string} note
 * @property {string} startedOn
 * @property {string} finishedOn
 * @property {number | null} rating
 * @property {number} rereadCount
 * @property {number} createdAt
 * @property {number} updatedAt
 */
/**
 * @typedef {object} ReadingLog
 * @property {string} id
 * @property {string} bookId
 * @property {number} page
 * @property {number} previousPage
 * @property {number} delta
 * @property {string} memo
 * @property {number} recordedAt
 * @property {boolean} finished
 */

/** @type {IDBDatabase} */
let database;
/** @type {Book[]} */
let books = [];
/** @type {ReadingLog[]} */
let logs = [];
let activeFilter = localStorage.getItem(filterKey) || "all";

const elements = {
  shelf: document.querySelector("[data-book-shelf]"),
  emptyShelf: document.querySelector("[data-empty-shelf]"),
  readingCount: document.querySelector("[data-reading-count]"),
  finishedCount: document.querySelector("[data-finished-count]"),
  pageCount: document.querySelector("[data-page-count]"),
  readingDays: document.querySelector("[data-reading-days]"),
  searchDialog: document.querySelector("[data-search-dialog]"),
  searchForm: document.querySelector("[data-search-form]"),
  searchState: document.querySelector("[data-search-state]"),
  searchResults: document.querySelector("[data-search-results]"),
  bookDialog: document.querySelector("[data-book-dialog]"),
  bookDialogTitle: document.querySelector("[data-book-dialog-title]"),
  bookForm: document.querySelector("[data-book-form]"),
  bookFormState: document.querySelector("[data-book-form-state]"),
  progressDialog: document.querySelector("[data-progress-dialog]"),
  progressForm: document.querySelector("[data-progress-form]"),
  progressTitle: document.querySelector("[data-progress-title]"),
  progressSpine: document.querySelector("[data-progress-spine]"),
  progressTotal: document.querySelector("[data-progress-total]"),
  progressState: document.querySelector("[data-progress-state]"),
  reviewDialog: document.querySelector("[data-review-dialog]"),
  readingCalendar: document.querySelector("[data-reading-calendar]"),
  calendarTotal: document.querySelector("[data-calendar-total]"),
  recentLogs: document.querySelector("[data-recent-logs]"),
  logEmpty: document.querySelector("[data-log-empty]"),
  shareCanvas: document.querySelector("[data-share-canvas]"),
  dataDialog: document.querySelector("[data-data-dialog]"),
  dataState: document.querySelector("[data-data-state]"),
  importFile: document.querySelector("[data-import-file]"),
  listDialog: document.querySelector("[data-list-dialog]"),
  listForm: document.querySelector("[data-list-form]"),
  listState: document.querySelector("[data-list-state]"),
};

const isUuid = (value) =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const makeId = () => crypto.randomUUID();
const pad = (value) => String(value).padStart(2, "0");
const localDay = (date = new Date()) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const asDate = (day) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return localDay(date) === day ? date : null;
};
const addDays = (date, amount) => {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
};
const dayFromTimestamp = (timestamp) => localDay(new Date(timestamp));
const formatDate = (day) => {
  const date = asDate(day);
  return date
    ? new Intl.DateTimeFormat("ja-JP", { month: "short", day: "numeric" }).format(date)
    : "";
};
const formatTimestamp = (timestamp) =>
  new Intl.DateTimeFormat("ja-JP", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
const formatNumber = (value) => new Intl.NumberFormat("ja-JP").format(value);
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const clear = (element) => {
  while (element?.firstChild) element.firstChild.remove();
};
const node = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};
const button = (label, className, action) => {
  const element = node("button", className, label);
  element.type = "button";
  element.dataset.action = action;
  return element;
};
const fieldValue = (form, name) => {
  const field = form.elements.namedItem(name);
  return field instanceof HTMLInputElement ||
    field instanceof HTMLTextAreaElement ||
    field instanceof HTMLSelectElement
    ? field.value
    : "";
};
const setField = (form, name, value) => {
  const field = form.elements.namedItem(name);
  if (
    field instanceof HTMLInputElement ||
    field instanceof HTMLTextAreaElement ||
    field instanceof HTMLSelectElement
  ) {
    field.value = value === null || value === undefined ? "" : String(value);
  }
};
const containsUnsafeControl = (value) =>
  Array.from(value).some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return (code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127;
  });
const textWithin = (value, maximum) =>
  typeof value === "string" && value.length <= maximum && !containsUnsafeControl(value);
const hasOnlyKeys = (value, keys) =>
  value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).length === keys.length &&
  Object.keys(value).every((key) => keys.includes(key));

let sessionId = makeId();
const setupSession = () => {
  const stored = localStorage.getItem(sessionKey) ?? "";
  sessionId = isUuid(stored) ? stored : makeId();
  localStorage.setItem(sessionKey, sessionId);
};

const qaMode =
  navigator.webdriver ||
  new URLSearchParams(location.search).get("qa") === "1" ||
  document.documentElement.dataset.qa === "1";

const track = (name) => {
  if (!isUuid(sessionId)) {
    sessionId = makeId();
    localStorage.setItem(sessionKey, sessionId);
  }
  void fetch("/api/events", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-shiori-session": sessionId,
      "x-shiori-qa": qaMode ? "1" : "0",
    },
    body: JSON.stringify({ name }),
    keepalive: true,
  }).catch(() => {});
};

const openDatabase = () =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion);
    request.onupgradeneeded = () => {
      const next = request.result;
      if (!next.objectStoreNames.contains("books")) {
        const store = next.createObjectStore("books", { keyPath: "id" });
        store.createIndex("state", "state");
        store.createIndex("updatedAt", "updatedAt");
      }
      if (!next.objectStoreNames.contains("logs")) {
        const store = next.createObjectStore("logs", { keyPath: "id" });
        store.createIndex("bookId", "bookId");
        store.createIndex("recordedAt", "recordedAt");
      }
      if (!next.objectStoreNames.contains("config")) {
        next.createObjectStore("config", { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const requestResult = (request) =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const transactionDone = (transaction) =>
  new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error("transaction aborted"));
  });

const readAll = (storeName) => {
  const transaction = database.transaction(storeName, "readonly");
  return requestResult(transaction.objectStore(storeName).getAll());
};

const putValue = (storeName, value) => {
  const transaction = database.transaction(storeName, "readwrite");
  transaction.objectStore(storeName).put(value);
  return transactionDone(transaction);
};

const refreshData = async () => {
  books = /** @type {Book[]} */ (await readAll("books")).sort(
    (left, right) =>
      stateOrder.indexOf(left.state) - stateOrder.indexOf(right.state) ||
      right.updatedAt - left.updatedAt,
  );
  logs = /** @type {ReadingLog[]} */ (await readAll("logs")).sort(
    (left, right) => right.recordedAt - left.recordedAt,
  );
};

const hashText = (text) => {
  let hash = 2166136261;
  for (const character of text) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
};

const spineClass = (book) => spineClasses[hashText(book.id || book.title) % spineClasses.length];

const bookById = (id) => books.find((book) => book.id === id);
const logsForBook = (id) => logs.filter((log) => log.bookId === id);
const pageTotal = () => logs.reduce((sum, log) => sum + Math.max(0, log.delta), 0);

const renderSummary = () => {
  if (elements.readingCount)
    elements.readingCount.textContent = String(
      books.filter((book) => book.state === "reading").length,
    );
  if (elements.finishedCount)
    elements.finishedCount.textContent = String(
      books.filter((book) => book.state === "finished").length,
    );
  if (elements.pageCount) elements.pageCount.textContent = formatNumber(pageTotal());
  if (elements.readingDays) {
    elements.readingDays.textContent = String(
      new Set(logs.map((log) => dayFromTimestamp(log.recordedAt))).size,
    );
  }
};

const makeProgressBar = (book) => {
  const wrap = node("div", "book-progress");
  const bar = node("span", "book-progress-bar");
  const ratio = book.totalPages ? clamp(book.currentPage / book.totalPages, 0, 1) : 0;
  bar.style.setProperty("--progress", `${Math.round(ratio * 100)}%`);
  wrap.append(bar);
  const label = node(
    "small",
    "",
    book.totalPages
      ? `${formatNumber(book.currentPage)} / ${formatNumber(book.totalPages)}頁`
      : book.currentPage
        ? `${formatNumber(book.currentPage)}頁`
        : "頁は未記録",
  );
  wrap.append(label);
  return wrap;
};

const makeBookCard = (book) => {
  const article = node("article", `book-card state-${book.state}`);
  article.dataset.bookId = book.id;

  const visual = node("div", `book-visual ${spineClass(book)}`);
  const cover = node("div", "book-cover");
  const initials = Array.from(book.title.replace(/\s/g, "")).slice(0, 2).join("");
  cover.append(node("span", "cover-title", initials || "本"));
  if (book.state === "reading") cover.append(node("i", "cover-ribbon"));
  const shadow = node("span", "book-shadow");
  visual.append(cover, shadow);

  const copy = node("div", "book-copy");
  const state = node("span", `state-badge ${book.state}`, stateLabels[book.state]);
  const title = node("h3", "", book.title);
  const author = node("p", "book-author", book.author || "著者未入力");
  copy.append(state, title, author, makeProgressBar(book));
  if (book.rating) {
    const rating = node("span", "book-rating", "★".repeat(book.rating));
    rating.setAttribute("aria-label", `評価 ${book.rating}`);
    copy.append(rating);
  }
  if (book.tags.length) {
    const tags = node("div", "tag-list");
    book.tags.slice(0, 3).forEach((tag) => tags.append(node("span", "", tag)));
    copy.append(tags);
  }

  const actions = node("div", "book-actions");
  const progress = button("しおり", "primary-button small", "open-progress");
  progress.dataset.bookId = book.id;
  const edit = button("編集", "quiet-button small", "edit-book");
  edit.dataset.bookId = book.id;
  actions.append(progress, edit);
  copy.append(actions);
  article.append(visual, copy);
  return article;
};

const renderShelf = () => {
  clear(elements.shelf);
  document.querySelectorAll("[data-filter]").forEach((control) => {
    if (control instanceof HTMLButtonElement) {
      control.setAttribute("aria-pressed", String(control.dataset.filter === activeFilter));
    }
  });
  const visible =
    activeFilter === "all" ? books : books.filter((book) => book.state === activeFilter);
  visible.forEach((book) => elements.shelf?.append(makeBookCard(book)));
  if (elements.emptyShelf instanceof HTMLElement) {
    elements.emptyShelf.hidden = books.length > 0 || activeFilter !== "all";
  }
  elements.shelf?.classList.toggle("is-empty-filter", visible.length === 0 && books.length > 0);
  if (visible.length === 0 && books.length > 0) {
    const empty = node("p", "filter-empty", "この棚には、まだ本がありません。");
    elements.shelf?.append(empty);
  }
};

const renderAll = () => {
  renderSummary();
  renderShelf();
};

const showDialog = (dialog) => {
  if (!(dialog instanceof HTMLDialogElement)) return;
  if (!dialog.open) dialog.showModal();
};

const closeDialog = (dialog) => {
  if (dialog instanceof HTMLDialogElement && dialog.open) dialog.close();
};

const resetBookForm = () => {
  if (!(elements.bookForm instanceof HTMLFormElement)) return;
  elements.bookForm.reset();
  setField(elements.bookForm, "id", "");
  setField(elements.bookForm, "state", "want");
  setField(elements.bookForm, "rereadCount", "0");
  if (elements.bookDialogTitle) elements.bookDialogTitle.textContent = "本を棚に置く";
  if (elements.bookFormState) elements.bookFormState.textContent = "";
};

const openBookForm = (values = {}) => {
  if (!(elements.bookForm instanceof HTMLFormElement)) return;
  resetBookForm();
  Object.entries(values).forEach(([name, value]) => setField(elements.bookForm, name, value));
  if (values.id && elements.bookDialogTitle) elements.bookDialogTitle.textContent = "本を編集する";
  closeDialog(elements.searchDialog);
  showDialog(elements.bookDialog);
  const title = elements.bookForm.elements.namedItem("title");
  if (title instanceof HTMLInputElement) title.focus();
};

const fillBookForm = (book) => {
  openBookForm({
    ...book,
    totalPages: book.totalPages ?? "",
    rating: book.rating ?? "",
    tags: book.tags.join(", "),
  });
};

const normalizeTags = (value) =>
  [
    ...new Set(
      value
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  ].slice(0, 12);

const saveBook = async (form) => {
  const id = fieldValue(form, "id");
  const existing = id ? bookById(id) : undefined;
  if (!existing && books.length >= maximumBooks) {
    throw new Error(`本は${maximumBooks}冊まで置けます。`);
  }
  const title = fieldValue(form, "title").trim();
  const totalRaw = fieldValue(form, "totalPages");
  const totalPages = totalRaw ? Number(totalRaw) : null;
  let currentPage = existing?.currentPage ?? 0;
  if (totalPages !== null) currentPage = clamp(currentPage, 0, totalPages);
  const now = Date.now();
  const state = fieldValue(form, "state");
  const finishedOn =
    state === "finished"
      ? fieldValue(form, "finishedOn") || localDay()
      : fieldValue(form, "finishedOn");
  const startedOn = ["reading", "finished", "paused"].includes(state)
    ? fieldValue(form, "startedOn") || existing?.startedOn || localDay()
    : fieldValue(form, "startedOn");

  /** @type {Book} */
  const book = {
    id: existing?.id ?? makeId(),
    title,
    author: fieldValue(form, "author").trim(),
    isbn: fieldValue(form, "isbn")
      .replace(/[^0-9X]/gi, "")
      .slice(0, 13),
    publisher: fieldValue(form, "publisher").trim(),
    publishedYear: fieldValue(form, "publishedYear"),
    state,
    totalPages,
    currentPage,
    series: fieldValue(form, "series").trim(),
    volume: fieldValue(form, "volume").trim(),
    tags: normalizeTags(fieldValue(form, "tags")),
    note: fieldValue(form, "note"),
    startedOn,
    finishedOn,
    rating: fieldValue(form, "rating") ? Number(fieldValue(form, "rating")) : null,
    rereadCount: Number(fieldValue(form, "rereadCount") || 0),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await putValue("books", book);
  await refreshData();
  renderAll();
  if (!existing) track("book_added");
  return book;
};

const renderSearchResults = (results) => {
  clear(elements.searchResults);
  results.forEach((result) => {
    const article = node("article", "search-result");
    const mark = node(
      "span",
      `result-spine ${spineClasses[hashText(result.title) % spineClasses.length]}`,
    );
    const copy = node("div", "result-copy");
    copy.append(node("h3", "", result.title));
    copy.append(node("p", "", result.author || "著者情報なし"));
    const details = [
      result.publisher,
      result.publishedYear,
      result.isbn ? `ISBN ${result.isbn}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    if (details) copy.append(node("small", "", details));
    if (result.url) {
      const source = node("a", "source-link", "書誌を見る");
      source.href = result.url;
      source.target = "_blank";
      source.rel = "noreferrer";
      copy.append(source);
    }
    const add = button("棚に置く", "quiet-button small", "add-search-result");
    add.dataset.book = JSON.stringify(result);
    article.append(mark, copy, add);
    elements.searchResults?.append(article);
  });
};

const searchBooks = async (form) => {
  const query = fieldValue(form, "query").trim();
  const author = fieldValue(form, "author").trim();
  if (elements.searchState) elements.searchState.textContent = "書誌を探しています…";
  clear(elements.searchResults);
  const submit = form.querySelector("button[type='submit']");
  if (submit instanceof HTMLButtonElement) submit.disabled = true;
  try {
    const response = await fetch("/api/books/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, author }),
    });
    const payload = await response.json();
    if (!response.ok || !Array.isArray(payload.books)) throw new Error("search failed");
    renderSearchResults(payload.books);
    if (elements.searchState) {
      elements.searchState.textContent = payload.books.length
        ? `${payload.books.length}件見つかりました。`
        : author
          ? "該当する本が見つかりませんでした。手入力もできます。"
          : "見つかりませんでした。著者名を加えるか、手入力してください。";
    }
    track("book_searched");
  } catch {
    if (elements.searchState) {
      elements.searchState.textContent =
        "いまは書誌を検索できません。手入力ならそのまま棚へ置けます。";
    }
  } finally {
    if (submit instanceof HTMLButtonElement) submit.disabled = false;
  }
};

const openProgress = (book) => {
  if (!(elements.progressForm instanceof HTMLFormElement)) return;
  elements.progressForm.reset();
  setField(elements.progressForm, "bookId", book.id);
  setField(elements.progressForm, "currentPage", String(book.currentPage));
  const pageField = elements.progressForm.elements.namedItem("currentPage");
  if (pageField instanceof HTMLInputElement) {
    pageField.max = String(book.totalPages ?? 100000);
  }
  if (elements.progressTitle) elements.progressTitle.textContent = book.title;
  if (elements.progressSpine) {
    elements.progressSpine.className = `mini-spine ${spineClass(book)}`;
  }
  if (elements.progressTotal) {
    elements.progressTotal.textContent = book.totalPages
      ? `/ ${formatNumber(book.totalPages)}頁`
      : "頁";
  }
  if (elements.progressState) elements.progressState.textContent = "";
  showDialog(elements.progressDialog);
};

const saveProgress = async (form) => {
  const book = bookById(fieldValue(form, "bookId"));
  if (!book) throw new Error("本が見つかりません。");
  if (logs.length >= maximumLogs) {
    throw new Error(`しおりは${maximumLogs}件まで記録できます。棚を保存して整理してください。`);
  }
  const page = Number(fieldValue(form, "currentPage"));
  const maximum = book.totalPages ?? 100000;
  if (!Number.isInteger(page) || page < 0 || page > maximum) {
    throw new Error(`0〜${formatNumber(maximum)}頁で入力してください。`);
  }
  const finishedField = form.elements.namedItem("finish");
  const finished = finishedField instanceof HTMLInputElement && finishedField.checked;
  const now = Date.now();
  /** @type {ReadingLog} */
  const log = {
    id: makeId(),
    bookId: book.id,
    page,
    previousPage: book.currentPage,
    delta: Math.max(0, page - book.currentPage),
    memo: fieldValue(form, "memo"),
    recordedAt: now,
    finished,
  };
  const updated = {
    ...book,
    currentPage: finished && book.totalPages ? book.totalPages : page,
    state: finished
      ? "finished"
      : book.state === "want" || book.state === "owned"
        ? "reading"
        : book.state,
    startedOn: book.startedOn || localDay(),
    finishedOn: finished ? localDay() : book.finishedOn,
    updatedAt: now,
  };
  const transaction = database.transaction(["books", "logs"], "readwrite");
  transaction.objectStore("books").put(updated);
  transaction.objectStore("logs").put(log);
  await transactionDone(transaction);
  await refreshData();
  renderAll();
  track("progress_updated");
  if (finished) track("book_finished");
};

const removeBook = async (book) => {
  if (!confirm(`「${book.title}」と、この本のしおりを棚から削除しますか？`)) return;
  const transaction = database.transaction(["books", "logs"], "readwrite");
  transaction.objectStore("books").delete(book.id);
  logsForBook(book.id).forEach((log) => transaction.objectStore("logs").delete(log.id));
  await transactionDone(transaction);
  await refreshData();
  renderAll();
  closeDialog(elements.bookDialog);
};

const renderCalendar = () => {
  clear(elements.readingCalendar);
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  const start = addDays(end, -83);
  const daily = new Map();
  logs.forEach((log) => {
    const day = dayFromTimestamp(log.recordedAt);
    daily.set(day, (daily.get(day) ?? 0) + Math.max(0, log.delta));
  });
  const values = [];
  for (let index = 0; index < 84; index += 1) {
    const date = addDays(start, index);
    const day = localDay(date);
    const pages = daily.get(day) ?? 0;
    values.push(pages);
    const cell = node("span", "calendar-cell");
    const level = pages === 0 ? 0 : pages < 10 ? 1 : pages < 30 ? 2 : pages < 60 ? 3 : 4;
    cell.dataset.level = String(level);
    cell.title = `${formatDate(day)} · ${pages}頁`;
    cell.setAttribute("aria-label", `${formatDate(day)} ${pages}頁`);
    elements.readingCalendar?.append(cell);
  }
  if (elements.calendarTotal) {
    elements.calendarTotal.textContent = `${formatNumber(values.reduce((sum, value) => sum + value, 0))}頁`;
  }
};

const renderRecentLogs = () => {
  clear(elements.recentLogs);
  const recent = logs.slice(0, 15);
  if (elements.logEmpty instanceof HTMLElement) elements.logEmpty.hidden = recent.length > 0;
  recent.forEach((log) => {
    const book = bookById(log.bookId);
    if (!book) return;
    const article = node("article", "recent-log");
    article.append(node("span", `log-dot ${spineClass(book)}`));
    const copy = node("div", "");
    copy.append(node("strong", "", book.title));
    const detail = log.finished
      ? `読了 · ${formatNumber(log.page)}頁`
      : `${formatNumber(log.page)}頁まで${log.delta > 0 ? ` · +${formatNumber(log.delta)}頁` : ""}`;
    copy.append(node("p", "", detail));
    if (log.memo) copy.append(node("small", "", log.memo));
    article.append(copy, node("time", "", formatTimestamp(log.recordedAt)));
    elements.recentLogs?.append(article);
  });
};

const renderReview = () => {
  renderCalendar();
  renderRecentLogs();
};

const downloadBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const formulaSafe = (value) => {
  const text = String(value ?? "");
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
};
const csvCell = (value) => `"${formulaSafe(value).replaceAll('"', '""')}"`;

const exportCsv = () => {
  const headers = [
    "書名",
    "著者",
    "ISBN",
    "出版社",
    "出版年",
    "棚",
    "現在頁",
    "総頁数",
    "読み始め",
    "読了日",
    "評価",
    "タグ",
    "メモ",
    "再読回数",
  ];
  const rows = books.map((book) =>
    [
      book.title,
      book.author,
      book.isbn,
      book.publisher,
      book.publishedYear,
      stateLabels[book.state],
      book.currentPage,
      book.totalPages ?? "",
      book.startedOn,
      book.finishedOn,
      book.rating ?? "",
      book.tags.join(", "),
      book.note,
      book.rereadCount,
    ]
      .map(csvCell)
      .join(","),
  );
  const csv = `\uFEFF${headers.map(csvCell).join(",")}\r\n${rows.join("\r\n")}`;
  downloadBlob(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
    `shiori-dana-${localDay()}.csv`,
  );
  track("csv_exported");
};

const exportProject = () => {
  const project = {
    format: "shiori-dana",
    version: 1,
    exportedAt: new Date().toISOString(),
    books,
    logs,
  };
  downloadBlob(
    new Blob([JSON.stringify(project, null, 2)], { type: "application/json" }),
    `shiori-dana-${localDay()}.shiori`,
  );
  track("project_exported");
};

const bookKeys = [
  "id",
  "title",
  "author",
  "isbn",
  "publisher",
  "publishedYear",
  "state",
  "totalPages",
  "currentPage",
  "series",
  "volume",
  "tags",
  "note",
  "startedOn",
  "finishedOn",
  "rating",
  "rereadCount",
  "createdAt",
  "updatedAt",
];
const logKeys = ["id", "bookId", "page", "previousPage", "delta", "memo", "recordedAt", "finished"];
const projectKeys = ["format", "version", "exportedAt", "books", "logs"];
const validDate = (value) => value === "" || asDate(value) !== null;
const validInteger = (value, minimum, maximum) =>
  Number.isInteger(value) && value >= minimum && value <= maximum;

const validImportedBook = (value) =>
  hasOnlyKeys(value, bookKeys) &&
  isUuid(value.id) &&
  textWithin(value.title, 200) &&
  value.title.trim().length > 0 &&
  textWithin(value.author, 160) &&
  textWithin(value.isbn, 13) &&
  textWithin(value.publisher, 160) &&
  textWithin(value.publishedYear, 4) &&
  stateOrder.includes(value.state) &&
  (value.totalPages === null || validInteger(value.totalPages, 1, 100000)) &&
  validInteger(value.currentPage, 0, value.totalPages ?? 100000) &&
  textWithin(value.series, 120) &&
  textWithin(value.volume, 40) &&
  Array.isArray(value.tags) &&
  value.tags.length <= 12 &&
  value.tags.every((tag) => textWithin(tag, 40) && tag.trim().length > 0) &&
  textWithin(value.note, 4000) &&
  validDate(value.startedOn) &&
  validDate(value.finishedOn) &&
  (value.rating === null || validInteger(value.rating, 1, 5)) &&
  validInteger(value.rereadCount, 0, 99) &&
  validInteger(value.createdAt, 1, 9_007_199_254_740_991) &&
  validInteger(value.updatedAt, 1, 9_007_199_254_740_991);

const validImportedLog = (value, bookIds) =>
  hasOnlyKeys(value, logKeys) &&
  isUuid(value.id) &&
  isUuid(value.bookId) &&
  bookIds.has(value.bookId) &&
  validInteger(value.page, 0, 100000) &&
  validInteger(value.previousPage, 0, 100000) &&
  validInteger(value.delta, 0, 100000) &&
  textWithin(value.memo, 500) &&
  validInteger(value.recordedAt, 1, 9_007_199_254_740_991) &&
  typeof value.finished === "boolean";

const importProject = async (file) => {
  if (file.size > 10_000_000) throw new Error("ファイルが大きすぎます。");
  let project;
  try {
    project = JSON.parse(await file.text());
  } catch {
    throw new Error("JSONとして読めませんでした。");
  }
  if (
    !hasOnlyKeys(project, projectKeys) ||
    project.format !== "shiori-dana" ||
    project.version !== 1 ||
    typeof project.exportedAt !== "string" ||
    !Number.isFinite(Date.parse(project.exportedAt)) ||
    !Array.isArray(project.books) ||
    !Array.isArray(project.logs) ||
    project.books.length > maximumBooks ||
    project.logs.length > maximumLogs
  ) {
    throw new Error("栞棚の編集用ファイルではないか、上限を超えています。");
  }
  if (!project.books.every(validImportedBook)) throw new Error("本のデータが壊れています。");
  const bookIds = new Set(project.books.map((book) => book.id));
  const logIds = new Set(project.logs.map((log) => log.id));
  if (bookIds.size !== project.books.length || logIds.size !== project.logs.length) {
    throw new Error("同じ識別子が重複しています。");
  }
  if (!project.logs.every((log) => validImportedLog(log, bookIds))) {
    throw new Error("しおりのデータが壊れています。");
  }
  if (
    !confirm(
      `現在の棚を、${project.books.length}冊・${project.logs.length}件のしおりで置き換えますか？`,
    )
  ) {
    return false;
  }
  const transaction = database.transaction(["books", "logs"], "readwrite");
  const bookStore = transaction.objectStore("books");
  const logStore = transaction.objectStore("logs");
  bookStore.clear();
  logStore.clear();
  project.books.forEach((book) => bookStore.put(book));
  project.logs.forEach((log) => logStore.put(log));
  await transactionDone(transaction);
  await refreshData();
  renderAll();
  track("project_imported");
  return true;
};

const importTitleList = async (form) => {
  const titles = [
    ...new Set(
      fieldValue(form, "titles")
        .split(/\r?\n/)
        .map((title) => title.trim())
        .filter(Boolean),
    ),
  ];
  if (!titles.length) throw new Error("書名を一行以上入力してください。");
  if (titles.length > maximumListImport) {
    throw new Error(`一度に置けるのは${maximumListImport}冊までです。`);
  }
  if (books.length + titles.length > maximumBooks) {
    throw new Error(`棚の上限${maximumBooks}冊を超えます。`);
  }
  if (titles.some((title) => !textWithin(title, 200))) {
    throw new Error("書名は一冊200文字以内にしてください。");
  }
  const now = Date.now();
  const transaction = database.transaction("books", "readwrite");
  const store = transaction.objectStore("books");
  titles.forEach((title, index) => {
    store.put({
      id: makeId(),
      title,
      author: "",
      isbn: "",
      publisher: "",
      publishedYear: "",
      state: "want",
      totalPages: null,
      currentPage: 0,
      series: "",
      volume: "",
      tags: [],
      note: "",
      startedOn: "",
      finishedOn: "",
      rating: null,
      rereadCount: 0,
      createdAt: now + index,
      updatedAt: now + index,
    });
  });
  await transactionDone(transaction);
  await refreshData();
  renderAll();
  titles.forEach(() => track("book_added"));
  return titles.length;
};

const roundedRectangle = (context, x, y, width, height, radius) => {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
  context.fill();
};

const saveShareCard = () => {
  if (!(elements.shareCanvas instanceof HTMLCanvasElement)) return;
  const context = elements.shareCanvas.getContext("2d");
  if (!context) return;
  const width = elements.shareCanvas.width;
  const height = elements.shareCanvas.height;
  const finishedThisMonth = books.filter((book) => {
    if (!book.finishedOn) return false;
    const date = asDate(book.finishedOn);
    const today = new Date();
    return (
      date && date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth()
    );
  }).length;
  const monthPrefix = localDay().slice(0, 7);
  const monthPages = logs
    .filter((log) => dayFromTimestamp(log.recordedAt).startsWith(monthPrefix))
    .reduce((sum, log) => sum + Math.max(0, log.delta), 0);

  context.fillStyle = "#f1eadc";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#ded1bc";
  context.fillRect(0, 505, width, 125);
  context.fillStyle = "#4b5b48";
  roundedRectangle(context, 72, 78, 78, 96, 10);
  context.fillStyle = "#d9774e";
  context.fillRect(121, 78, 13, 56);
  context.fillStyle = "#253127";
  context.font = "700 35px system-ui, sans-serif";
  context.fillText("栞棚", 176, 139);
  context.fillStyle = "#756e62";
  context.font = "500 22px system-ui, sans-serif";
  context.fillText(`${new Date().getFullYear()}年${new Date().getMonth() + 1}月の読書`, 72, 245);

  context.fillStyle = "#fffaf1";
  roundedRectangle(context, 72, 288, 460, 164, 24);
  roundedRectangle(context, 568, 288, 460, 164, 24);
  context.fillStyle = "#253127";
  context.font = "700 76px system-ui, sans-serif";
  context.fillText(String(finishedThisMonth), 114, 390);
  context.fillText(formatNumber(monthPages), 610, 390);
  context.fillStyle = "#756e62";
  context.font = "500 24px system-ui, sans-serif";
  context.fillText("冊 読み終えた", 202, 390);
  context.fillText(
    "頁 読んだ",
    610 + context.measureText(formatNumber(monthPages)).width + 20,
    390,
  );

  const colors = ["#c96f4f", "#5d745c", "#d6a248", "#56718a", "#986b77", "#6a5771"];
  colors.forEach((color, index) => {
    context.fillStyle = color;
    const bookWidth = 42 + (index % 3) * 8;
    const bookHeight = 70 + ((index * 17) % 45);
    roundedRectangle(context, 770 + index * 54, 505 - bookHeight, bookWidth, bookHeight, 4);
  });
  context.fillStyle = "#756e62";
  context.font = "500 20px system-ui, sans-serif";
  context.fillText("shiori-dana.yhay81.com", 72, 574);
  elements.shareCanvas.toBlob((blob) => {
    if (!blob) return;
    downloadBlob(blob, `shiori-dana-${localDay()}.png`);
    track("share_card_saved");
  }, "image/png");
};

document.addEventListener("submit", (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;

  if (form.matches("[data-search-form]")) {
    event.preventDefault();
    void searchBooks(form);
  }

  if (form.matches("[data-book-form]")) {
    event.preventDefault();
    if (elements.bookFormState) elements.bookFormState.textContent = "棚へ置いています…";
    void saveBook(form)
      .then(() => {
        closeDialog(elements.bookDialog);
      })
      .catch((error) => {
        if (elements.bookFormState) {
          elements.bookFormState.textContent =
            error instanceof Error ? error.message : "保存できませんでした。";
        }
      });
  }

  if (form.matches("[data-progress-form]")) {
    event.preventDefault();
    if (elements.progressState) elements.progressState.textContent = "しおりを挟んでいます…";
    void saveProgress(form)
      .then(() => {
        closeDialog(elements.progressDialog);
      })
      .catch((error) => {
        if (elements.progressState) {
          elements.progressState.textContent =
            error instanceof Error ? error.message : "記録できませんでした。";
        }
      });
  }

  if (form.matches("[data-list-form]")) {
    event.preventDefault();
    if (elements.listState) elements.listState.textContent = "棚へ置いています…";
    void importTitleList(form)
      .then((count) => {
        if (elements.listState) elements.listState.textContent = `${count}冊を置きました。`;
        form.reset();
        setTimeout(() => closeDialog(elements.listDialog), 500);
      })
      .catch((error) => {
        if (elements.listState) {
          elements.listState.textContent =
            error instanceof Error ? error.message : "追加できませんでした。";
        }
      });
  }
});

document.addEventListener("click", (event) => {
  const target =
    event.target instanceof Element ? event.target.closest("button, [data-action]") : null;
  if (!(target instanceof HTMLElement)) return;
  const action = target.dataset.action;

  if (target.hasAttribute("data-close-dialog")) {
    closeDialog(target.closest("dialog"));
    return;
  }
  if (action === "open-search") {
    showDialog(elements.searchDialog);
    const field = elements.searchForm?.querySelector("input[name='query']");
    if (field instanceof HTMLInputElement) field.focus();
  }
  if (action === "open-manual") openBookForm();
  if (action === "open-list-import") {
    closeDialog(elements.searchDialog);
    if (elements.listState) elements.listState.textContent = "";
    showDialog(elements.listDialog);
  }
  if (action === "open-data") {
    if (elements.dataState) elements.dataState.textContent = "";
    showDialog(elements.dataDialog);
  }
  if (action === "open-review") {
    renderReview();
    showDialog(elements.reviewDialog);
    track("review_opened");
  }
  if (action === "save-share-card") saveShareCard();
  if (action === "export-csv") exportCsv();
  if (action === "export-project") exportProject();
  if (action === "add-search-result") {
    try {
      const result = JSON.parse(target.dataset.book ?? "{}");
      openBookForm({
        title: result.title ?? "",
        author: result.author ?? "",
        isbn: result.isbn ?? "",
        publisher: result.publisher ?? "",
        publishedYear: result.publishedYear ?? "",
        state: "want",
      });
    } catch {
      openBookForm();
    }
  }
  if (action === "edit-book") {
    const book = bookById(target.dataset.bookId);
    if (book) fillBookForm(book);
  }
  if (action === "open-progress") {
    const book = bookById(target.dataset.bookId);
    if (book) openProgress(book);
  }
  if (action === "delete-book") {
    const id = fieldValue(elements.bookForm, "id");
    const book = bookById(id);
    if (book) void removeBook(book);
  }
});

document.querySelectorAll("[data-filter]").forEach((control) => {
  control.addEventListener("click", () => {
    activeFilter = control.dataset.filter ?? "all";
    localStorage.setItem(filterKey, activeFilter);
    renderShelf();
  });
});

if (elements.bookForm instanceof HTMLFormElement) {
  const deleteButton = button("本を削除", "danger-button", "delete-book");
  deleteButton.dataset.editOnly = "true";
  elements.bookForm.querySelector(".dialog-actions")?.prepend(deleteButton);
  const idField = elements.bookForm.elements.namedItem("id");
  const updateDeleteVisibility = () => {
    deleteButton.hidden = !(idField instanceof HTMLInputElement && idField.value);
  };
  new MutationObserver(updateDeleteVisibility).observe(elements.bookDialog, {
    attributes: true,
    attributeFilter: ["open"],
  });
  elements.bookDialog?.addEventListener("close", updateDeleteVisibility);
}

if (elements.importFile instanceof HTMLInputElement) {
  elements.importFile.addEventListener("change", () => {
    const file = elements.importFile.files?.[0];
    if (!file) return;
    if (elements.dataState) elements.dataState.textContent = "ファイルを確認しています…";
    void importProject(file)
      .then((imported) => {
        if (elements.dataState) {
          elements.dataState.textContent = imported
            ? "棚を戻しました。"
            : "読み込みを取りやめました。";
        }
      })
      .catch((error) => {
        if (elements.dataState) {
          elements.dataState.textContent =
            error instanceof Error ? error.message : "読み込めませんでした。";
        }
      })
      .finally(() => {
        elements.importFile.value = "";
      });
  });
}

document.querySelectorAll("dialog").forEach((dialog) => {
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) closeDialog(dialog);
  });
  dialog.addEventListener("cancel", () => closeDialog(dialog));
});

const begin = async () => {
  setupSession();
  database = await openDatabase();
  await refreshData();
  renderAll();

  const today = localDay();
  const previousVisit = localStorage.getItem(visitKey);
  track("visited");
  if (previousVisit && previousVisit !== today) track("returned");
  localStorage.setItem(visitKey, today);

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      void navigator.serviceWorker.register("/sw.js").catch(() => {});
    });
  }
};

void begin().catch(() => {
  const message = node(
    "p",
    "startup-error",
    "このブラウザーでは棚を開けませんでした。サイトデータの保存を許可して、再読み込みしてください。",
  );
  document.querySelector("main")?.prepend(message);
});
