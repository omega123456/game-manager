//! Pagination for the Log Viewer (`list_logs_impl`) integration tests.

use chrono::{Duration, Utc};
use game_manager_lib::commands::logging::{
    list_logs_impl, list_logs_impl_with_minimum_level, LOG_MIN_PAGES, LOG_PAGE_SIZE,
};
use game_manager_lib::db::repo::logs::{self, NewLog};
use game_manager_lib::domain::LogLevel;
use game_manager_lib::state::AppState;

/// Insert `count` log rows with the given RFC 3339 timestamp. Message carries the
/// index so ordering can be asserted.
fn seed(state: &AppState, count: i64, ts: &str) {
    seed_with(state, count, ts, LogLevel::Info, "test");
}

/// Insert `count` rows with an explicit level and category.
fn seed_with(state: &AppState, count: i64, ts: &str, level: LogLevel, category: &str) {
    state
        .with_db(|conn| {
            for i in 0..count {
                logs::insert(
                    conn,
                    &NewLog {
                        ts: ts.to_string(),
                        level,
                        category: category.to_string(),
                        message: format!("msg-{i}"),
                        game_id: None,
                        script_id: None,
                        details: None,
                    },
                )?;
            }
            Ok(())
        })
        .unwrap();
}

#[test]
fn empty_logs_return_empty_page() {
    let state = AppState::in_memory().unwrap();
    let page = list_logs_impl(&state, 1, LOG_PAGE_SIZE, None, None).unwrap();
    assert!(page.entries.is_empty());
    assert_eq!(page.total, 0);
    assert_eq!(page.page, 1);
    assert_eq!(page.page_size, LOG_PAGE_SIZE);
}

#[test]
fn paginates_small_set_newest_first() {
    let state = AppState::in_memory().unwrap();
    // 30 fresh rows -> bounded total is the actual count (well under the floor).
    let now = Utc::now().to_rfc3339();
    seed(&state, 30, &now);

    let first = list_logs_impl(&state, 1, LOG_PAGE_SIZE, None, None).unwrap();
    assert_eq!(first.total, 30);
    assert_eq!(first.entries.len(), 25);
    // Newest first: ties on ts are broken by id DESC, so the last-inserted row leads.
    assert_eq!(first.entries[0].message, "msg-29");

    let second = list_logs_impl(&state, 2, LOG_PAGE_SIZE, None, None).unwrap();
    assert_eq!(second.entries.len(), 5);
    assert_eq!(second.entries[0].message, "msg-4");

    // No id appears on more than one page.
    let third = list_logs_impl(&state, 3, LOG_PAGE_SIZE, None, None).unwrap();
    assert!(third.entries.is_empty());
}

#[test]
fn page_below_one_is_clamped() {
    let state = AppState::in_memory().unwrap();
    seed(&state, 5, &Utc::now().to_rfc3339());
    let page = list_logs_impl(&state, 0, LOG_PAGE_SIZE, None, None).unwrap();
    assert_eq!(page.page, 1);
    assert_eq!(page.entries.len(), 5);
}

#[test]
fn day_window_extends_beyond_the_minimum_pages() {
    let state = AppState::in_memory().unwrap();
    // More than the 50-page floor, all within the last day -> the whole day shows.
    let floor = LOG_PAGE_SIZE * LOG_MIN_PAGES;
    let total = floor + 40;
    seed(&state, total, &Utc::now().to_rfc3339());

    let page = list_logs_impl(&state, 1, LOG_PAGE_SIZE, None, None).unwrap();
    assert_eq!(page.total, total, "a full day of logs exceeds the floor");
}

#[test]
fn floor_caps_the_window_when_few_logs_are_recent() {
    let state = AppState::in_memory().unwrap();
    let floor = LOG_PAGE_SIZE * LOG_MIN_PAGES;
    // 100 recent + many stale rows; only the floor (50 pages) is exposed because
    // the recent-day count is smaller than the floor.
    seed(&state, 100, &Utc::now().to_rfc3339());
    let stale = (Utc::now() - Duration::days(3)).to_rfc3339();
    seed(&state, floor + 200, &stale);

    let page = list_logs_impl(&state, 1, LOG_PAGE_SIZE, None, None).unwrap();
    assert_eq!(page.total, floor, "window is capped at the 50-page floor");
}

#[test]
fn filters_by_level() {
    let state = AppState::in_memory().unwrap();
    let now = Utc::now().to_rfc3339();
    seed_with(&state, 4, &now, LogLevel::Error, "launch");
    seed_with(&state, 6, &now, LogLevel::Info, "launch");

    let errors = list_logs_impl(&state, 1, LOG_PAGE_SIZE, Some("error"), None).unwrap();
    assert_eq!(errors.total, 4);
    assert!(errors.entries.iter().all(|e| e.level == LogLevel::Error));

    // Unmatched level yields an empty page rather than an error.
    let none = list_logs_impl(&state, 1, LOG_PAGE_SIZE, Some("warn"), None).unwrap();
    assert_eq!(none.total, 0);
    assert!(none.entries.is_empty());
}

#[test]
fn info_minimum_excludes_verbose_rows_from_all_filters() {
    let state = AppState::in_memory().unwrap();
    let now = Utc::now().to_rfc3339();
    seed_with(&state, 3, &now, LogLevel::Debug, "dlss");
    seed_with(&state, 2, &now, LogLevel::Info, "dlss");
    seed_with(&state, 1, &now, LogLevel::Warn, "dlss");

    let all =
        list_logs_impl_with_minimum_level(&state, 1, LOG_PAGE_SIZE, None, None, false).unwrap();
    assert_eq!(all.total, 3);
    assert!(all
        .entries
        .iter()
        .all(|entry| entry.level != LogLevel::Debug));

    let debug =
        list_logs_impl_with_minimum_level(&state, 1, LOG_PAGE_SIZE, Some("debug"), None, false)
            .unwrap();
    assert_eq!(debug.total, 0);
    assert!(debug.entries.is_empty());

    let debug_visible =
        list_logs_impl_with_minimum_level(&state, 1, LOG_PAGE_SIZE, Some("debug"), None, true)
            .unwrap();
    assert_eq!(debug_visible.total, 3);
    assert!(debug_visible
        .entries
        .iter()
        .all(|entry| entry.level == LogLevel::Debug));
}

#[test]
fn filters_by_search_term_across_message_and_category() {
    let state = AppState::in_memory().unwrap();
    let now = Utc::now().to_rfc3339();
    // Messages are msg-0..msg-9; only "msg-3" contains the substring "3".
    seed_with(&state, 10, &now, LogLevel::Info, "launch");
    seed_with(&state, 2, &now, LogLevel::Info, "steam-script");

    // Match on category substring.
    let by_category = list_logs_impl(&state, 1, LOG_PAGE_SIZE, None, Some("steam")).unwrap();
    assert_eq!(by_category.total, 2);
    assert!(by_category
        .entries
        .iter()
        .all(|e| e.category == "steam-script"));

    // Match on message substring (msg-3 in both categories => 2 rows).
    let by_message = list_logs_impl(&state, 1, LOG_PAGE_SIZE, None, Some("msg-3")).unwrap();
    assert_eq!(by_message.total, 1);

    // Blank/whitespace search behaves like no filter.
    let blank = list_logs_impl(&state, 1, LOG_PAGE_SIZE, None, Some("   ")).unwrap();
    assert_eq!(blank.total, 12);

    // Level + search combine (AND).
    let combined = list_logs_impl(&state, 1, LOG_PAGE_SIZE, Some("info"), Some("steam")).unwrap();
    assert_eq!(combined.total, 2);
}
