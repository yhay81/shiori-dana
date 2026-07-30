WITH clean_events AS (
  SELECT name, session_id, day, created_at
  FROM product_events
  WHERE is_qa = 0
),
book_depth AS (
  SELECT session_id, COUNT(*) AS books_added
  FROM clean_events
  WHERE name = 'book_added'
  GROUP BY session_id
),
reading_depth AS (
  SELECT
    session_id,
    COUNT(*) AS updates,
    COUNT(DISTINCT day) AS update_days,
    julianday(MAX(day)) - julianday(MIN(day)) AS span_days
  FROM clean_events
  WHERE name = 'progress_updated'
  GROUP BY session_id
),
funnel AS (
  SELECT
    COUNT(DISTINCT CASE WHEN name = 'visited' THEN session_id END) AS users,
    COUNT(DISTINCT CASE WHEN name = 'book_searched' THEN session_id END) AS searchers,
    COUNT(DISTINCT CASE WHEN name = 'book_added' THEN session_id END) AS book_adders,
    COUNT(DISTINCT CASE WHEN name = 'progress_updated' THEN session_id END) AS progress_updaters,
    COUNT(DISTINCT CASE WHEN name = 'book_finished' THEN session_id END) AS finishers,
    COUNT(DISTINCT CASE WHEN name = 'review_opened' THEN session_id END) AS reviewers,
    COUNT(DISTINCT CASE WHEN name = 'share_card_saved' THEN session_id END) AS share_card_users,
    COUNT(DISTINCT CASE WHEN name = 'csv_exported' THEN session_id END) AS csv_exporters,
    COUNT(DISTINCT CASE WHEN name = 'project_exported' THEN session_id END) AS project_exporters,
    COUNT(DISTINCT CASE WHEN name = 'project_imported' THEN session_id END) AS importers,
    COUNT(DISTINCT CASE WHEN name = 'returned' THEN session_id END) AS returned,
    COUNT(DISTINCT CASE
      WHEN name = 'progress_updated'
       AND created_at >= unixepoch() - 604800 THEN session_id
    END) AS progress_updaters_7d
  FROM clean_events
)
SELECT
  funnel.*,
  (SELECT COUNT(*) FROM book_depth WHERE books_added >= 5) AS five_book_users,
  (SELECT COUNT(*) FROM reading_depth WHERE update_days >= 3) AS three_day_readers,
  (SELECT COUNT(*) FROM reading_depth WHERE span_days >= 7) AS readers_spanning_7d,
  (SELECT COUNT(*) FROM reading_depth WHERE updates >= 3) AS three_update_readers
FROM funnel;
