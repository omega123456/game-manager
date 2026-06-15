//! Shared domain DTOs and enums.
//!
//! Every type that crosses the IPC boundary uses `#[serde(rename_all = "camelCase")]`
//! so the frontend receives camelCase JSON. These mirror the TypeScript types in
//! `src/types/`. Phase A2 introduces the data models; command handlers that
//! consume them land in later phases.

use serde::{Deserialize, Serialize};

/// Process-monitoring strategy for a game.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MonitorMode {
    /// Job-object tree tracking (default, zero-config).
    Tree,
    /// Named-process tracking (for store/launcher titles).
    Named,
}

impl MonitorMode {
    /// The database string representation.
    pub fn as_db_str(self) -> &'static str {
        match self {
            MonitorMode::Tree => "tree",
            MonitorMode::Named => "named",
        }
    }

    /// Parse from the database string representation.
    pub fn from_db_str(value: &str) -> Option<Self> {
        match value {
            "tree" => Some(MonitorMode::Tree),
            "named" => Some(MonitorMode::Named),
            _ => None,
        }
    }
}

/// The mutually-exclusive kind of a script.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ScriptKind {
    /// Normal script — assigned directly or via groups; has phases + priority.
    Normal,
    /// Utility script — a phase-less snippet/library that other scripts `require`.
    Utility,
    /// Global script — runs for every game; has phases + priority.
    Global,
}

impl ScriptKind {
    /// The database string representation.
    pub fn as_db_str(self) -> &'static str {
        match self {
            ScriptKind::Normal => "normal",
            ScriptKind::Utility => "utility",
            ScriptKind::Global => "global",
        }
    }

    /// Parse from the database string representation.
    pub fn from_db_str(value: &str) -> Option<Self> {
        match value {
            "normal" => Some(ScriptKind::Normal),
            "utility" => Some(ScriptKind::Utility),
            "global" => Some(ScriptKind::Global),
            _ => None,
        }
    }
}

/// How a phase (or utility snippet) is sourced.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PhaseMode {
    /// Phase/snippet not configured.
    #[default]
    None,
    /// An external script/executable already on disk.
    Path,
    /// Code stored in the database.
    Inline,
}

impl PhaseMode {
    /// The database string representation.
    pub fn as_db_str(self) -> &'static str {
        match self {
            PhaseMode::None => "none",
            PhaseMode::Path => "path",
            PhaseMode::Inline => "inline",
        }
    }

    /// Parse from the database string representation.
    pub fn from_db_str(value: &str) -> Option<Self> {
        match value {
            "none" => Some(PhaseMode::None),
            "path" => Some(PhaseMode::Path),
            "inline" => Some(PhaseMode::Inline),
            _ => None,
        }
    }
}

/// Interpreter for inline code.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Interpreter {
    /// Windows PowerShell.
    Powershell,
    /// Windows batch (cmd).
    Batch,
}

impl Interpreter {
    /// The database string representation.
    pub fn as_db_str(self) -> &'static str {
        match self {
            Interpreter::Powershell => "powershell",
            Interpreter::Batch => "batch",
        }
    }

    /// Parse from the database string representation.
    pub fn from_db_str(value: &str) -> Option<Self> {
        match value {
            "powershell" => Some(Interpreter::Powershell),
            "batch" => Some(Interpreter::Batch),
            _ => None,
        }
    }
}

/// Severity level for an application log row.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LogLevel {
    /// Debug-level diagnostics.
    Debug,
    /// Informational messages.
    Info,
    /// Warnings.
    Warn,
    /// Errors.
    Error,
}

impl LogLevel {
    /// The database string representation.
    pub fn as_db_str(self) -> &'static str {
        match self {
            LogLevel::Debug => "debug",
            LogLevel::Info => "info",
            LogLevel::Warn => "warn",
            LogLevel::Error => "error",
        }
    }

    /// Parse from the database string representation.
    pub fn from_db_str(value: &str) -> Option<Self> {
        match value {
            "debug" => Some(LogLevel::Debug),
            "info" => Some(LogLevel::Info),
            "warn" => Some(LogLevel::Warn),
            "error" => Some(LogLevel::Error),
            _ => None,
        }
    }
}

/// A phase in the launch lifecycle (event payload phase).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LaunchPhase {
    /// Running pre-launch scripts.
    Before,
    /// Waiting for the game process to appear.
    WaitingForProcess,
    /// The game is running (session active).
    Playing,
    /// Running cleanup scripts after exit.
    OnExit,
    /// The session has ended.
    Ended,
}

/// One of the three executable script phases used by the resolver/executor.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ScriptPhase {
    /// Run before launching the game.
    Before,
    /// Run after the target process has been detected.
    After,
    /// Run after the game exits.
    OnExit,
}

/// Provenance of a resolved script entry.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Provenance {
    /// A global script (runs for every game).
    Global,
    /// Inherited via a group.
    Group,
    /// Directly assigned to the game.
    Direct,
}

/// Provider/source for art candidates and metadata suggestions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ArtSource {
    /// SteamGridDB portrait grid art.
    SteamGridDb,
    /// Steam metadata / header-art fallback.
    Steam,
    /// No remote provider succeeded; fall back to the raw input.
    Input,
}

/// One configured phase of a normal/global script.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhaseConfig {
    /// How the phase is sourced.
    pub mode: PhaseMode,
    /// External path (when `mode == Path`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    /// Inline code (when `mode == Inline`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inline: Option<String>,
    /// Interpreter for inline code.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub interpreter: Option<Interpreter>,
}

impl Default for PhaseConfig {
    fn default() -> Self {
        PhaseConfig {
            mode: PhaseMode::None,
            path: None,
            inline: None,
            interpreter: None,
        }
    }
}

/// A game in the library, including computed playtime aggregates.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Game {
    /// Primary key.
    pub id: i64,
    /// Display name.
    pub name: String,
    /// Launch target (exe / shortcut / uri).
    pub launch_target: String,
    /// Process-monitoring mode.
    pub monitor_mode: MonitorMode,
    /// Real process name (required for `MonitorMode::Named`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub monitor_process_name: Option<String>,
    /// Launch arguments.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub arguments: Option<String>,
    /// Cover-art image path.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image_path: Option<String>,
    /// Ids of groups this game belongs to.
    pub group_ids: Vec<i64>,
    /// Ids of scripts directly assigned to this game.
    pub script_ids: Vec<i64>,
    /// Creation timestamp (RFC 3339).
    pub created_at: String,
    /// Computed total playtime across all sessions, in seconds.
    pub total_playtime_seconds: i64,
    /// Computed last-played timestamp (RFC 3339), if any session exists.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_played_at: Option<String>,
}

/// A script: normal/global (phases + priority) or utility (single snippet).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Script {
    /// Primary key.
    pub id: i64,
    /// Display name.
    pub name: String,
    /// Optional description.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Mutually-exclusive kind.
    pub kind: ScriptKind,
    /// Priority 1–10 (used by normal/global; ignored for utility).
    pub priority: i64,
    /// Before-launch phase (normal/global).
    pub before_launch: PhaseConfig,
    /// After-process-detected phase (normal/global).
    pub after_launch: PhaseConfig,
    /// On-exit phase (normal/global).
    pub on_exit: PhaseConfig,
    /// The single snippet (utility).
    pub snippet: PhaseConfig,
    /// Creation timestamp (RFC 3339).
    pub created_at: String,
    /// Ids of required utility scripts (require/include edges).
    pub requires: Vec<i64>,
}

/// A group of games sharing assigned scripts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Group {
    /// Primary key.
    pub id: i64,
    /// Display name.
    pub name: String,
    /// Optional description.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Ids of scripts assigned to this group.
    pub script_ids: Vec<i64>,
    /// Ids of games that belong to this group.
    pub game_ids: Vec<i64>,
}

/// A single key/value entry from the `settings` table.
///
/// Values are stored verbatim (plaintext) — including API keys, which are not
/// encrypted at rest in this single-user local app.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Setting {
    /// Setting key (e.g. `steamgriddb_api_key`, `theme`, `accent`).
    pub key: String,
    /// Setting value, or `None` when the row exists with a null value.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
}

/// A single tracked play session.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaySession {
    /// Primary key.
    pub id: i64,
    /// The game this session belongs to.
    pub game_id: i64,
    /// Session start timestamp (RFC 3339).
    pub started_at: String,
    /// Session end timestamp (RFC 3339), if ended.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ended_at: Option<String>,
}

/// A resolved script entry within a phase (resolver output / preview).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedScript {
    /// The underlying script id.
    pub script_id: i64,
    /// Script name.
    pub name: String,
    /// Effective priority.
    pub priority: i64,
    /// The phase this entry belongs to.
    pub phase: ScriptPhase,
    /// Provenance of the entry.
    pub provenance: Provenance,
    /// The group name when provenance is `Group`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_name: Option<String>,
    /// 1-based order within the phase.
    pub order: i64,
    /// Names of required utilities sourced into this entry.
    pub required_utility_names: Vec<String>,
}

/// A selectable cover-art candidate for the Add Game flow.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtCandidate {
    /// Provider-stable candidate id.
    pub id: String,
    /// Candidate image URL (remote until cached).
    pub image_url: String,
    /// Provider/source of the candidate.
    pub source: ArtSource,
    /// Pixel width of the candidate image.
    pub width: i64,
    /// Pixel height of the candidate image.
    pub height: i64,
    /// Provider display name for grouping/debugging.
    pub provider_name: String,
}

/// Metadata autofill result for the Add Game flow.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataResult {
    /// Canonical/fallback name to seed into the wizard.
    pub canonical_name: String,
    /// Provider used to derive the name.
    pub source: ArtSource,
}

/// An application log row.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    /// Primary key.
    pub id: i64,
    /// Timestamp (RFC 3339).
    pub ts: String,
    /// Severity level.
    pub level: LogLevel,
    /// Category (free-form domain tag).
    pub category: String,
    /// Log message.
    pub message: String,
    /// Optional associated game id.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub game_id: Option<i64>,
    /// Optional associated script id.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub script_id: Option<i64>,
    /// Optional structured details (free-form / JSON).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<String>,
}
