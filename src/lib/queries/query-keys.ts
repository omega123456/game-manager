export const GAMES_QUERY_KEY = ['games'] as const
export const PLAY_NOW_QUERY_KEY = [...GAMES_QUERY_KEY, 'play-now'] as const
export const SCRIPT_EXECUTION_QUERY_KEY = ['script-execution'] as const

export const GROUPS_QUERY_KEY = ['groups'] as const

export const DLSS_QUERY_KEY = ['dlss'] as const
export const DLSS_SUPPORT_QUERY_KEY = [...DLSS_QUERY_KEY, 'support'] as const
export const DLSS_SCAN_STATUS_QUERY_KEY = [...DLSS_QUERY_KEY, 'scan-status'] as const
export const DLSS_CATALOG_QUERY_KEY = [...DLSS_QUERY_KEY, 'catalog'] as const
export const DLSS_STATES_QUERY_KEY = [...DLSS_QUERY_KEY, 'states'] as const
export const DLSS_GAME_STATE_QUERY_KEY = [...DLSS_QUERY_KEY, 'game-state'] as const
export const DLSS_GLOBAL_PRESET_QUERY_KEY = [...DLSS_QUERY_KEY, 'global-preset'] as const
export const DLSS_GLOBAL_INDICATOR_QUERY_KEY = [...DLSS_QUERY_KEY, 'global-indicator'] as const
export const DLSS_GAME_PRESET_QUERY_KEY = [...DLSS_QUERY_KEY, 'game-preset'] as const
export const DLSS_PRESET_OPTIONS_QUERY_KEY = [...DLSS_QUERY_KEY, 'preset-options'] as const
export const DLSS_APPLICABLE_QUERY_KEY = [...DLSS_QUERY_KEY, 'applicable'] as const
