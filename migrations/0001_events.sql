CREATE TABLE product_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL
    CHECK(name IN (
      'visited',
      'book_searched',
      'book_added',
      'progress_updated',
      'book_finished',
      'review_opened',
      'share_card_saved',
      'csv_exported',
      'project_exported',
      'project_imported',
      'returned'
    )),
  session_id TEXT NOT NULL CHECK(length(session_id) = 36),
  day TEXT NOT NULL CHECK(length(day) = 10),
  created_at INTEGER NOT NULL,
  is_qa INTEGER NOT NULL DEFAULT 0 CHECK(is_qa IN (0, 1))
);

CREATE INDEX product_events_day_idx ON product_events(day, name, is_qa);
