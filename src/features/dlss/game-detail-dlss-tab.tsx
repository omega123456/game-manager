import * as React from 'react'
import { open } from '@tauri-apps/plugin-dialog'

import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import { logFrontend, toast, toastError } from '@/lib/app-log-commands'
import {
  useDlssCatalogQuery,
  useDlssGamePresetQuery,
  useDlssGameStateQuery,
  useDlssPresetOptionsQuery,
  useDlssDownloadProgress,
  useDlssSupportQuery,
  useSaveDlssGameMutation,
} from '@/lib/queries/use-dlss'
import {
  DLL_TYPE_LABELS,
  DLL_TYPES,
  type DllCatalog,
  type DllType,
  type GameDlssState,
  type SaveGameDllSelection,
  type SaveGameDlss,
} from '@/types/dlss'

import { DllVersionCombobox } from './dll-version-combobox'
import { PresetCombobox } from './preset-combobox'
import { DlssUnsupportedCallout } from './dlss-unsupported-callout'
import { isElevationError, showElevationToast } from './elevation-toast'

const CATALOG_KEY: Record<
  DllType,
  keyof Pick<DllCatalog, 'superResolution' | 'frameGeneration' | 'rayReconstruction'>
> = {
  superResolution: 'superResolution',
  frameGeneration: 'frameGeneration',
  rayReconstruction: 'rayReconstruction',
}

/** Normalize a Tauri dialog result to a single path string (or null). */
function normalizeDialogPath(value: string | string[] | null): string | null {
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0] : null
  }
  return typeof value === 'string' ? value : null
}

/** Read the detected display version for a DLL type off the cached state. */
function detectedVersion(state: GameDlssState | undefined, type: DllType): string | undefined {
  if (!state) {
    return undefined
  }
  switch (type) {
    case 'superResolution':
      return state.superResolution?.version
    case 'frameGeneration':
      return state.frameGeneration?.version
    case 'rayReconstruction':
      return state.rayReconstruction?.version
  }
}

export interface GameDetailDlssTabProps {
  /** The game this tab manages. */
  gameId: number
}

const PRESET_DEFAULT_VALUE = 0

/** Read-only summary row for one detected DLL. */
function DetectedRow({ label, version }: { label: string; version?: string }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="text-foreground">{label}</span>
      {version ? (
        <span className="font-mono text-foreground">v{version}</span>
      ) : (
        <span className="text-muted-foreground">Not detected</span>
      )}
    </div>
  )
}

/**
 * Per-game DLSS tab: a read-only detected-versions summary, three DLL version
 * pickers preselected to detected versions, two preset pickers preselected from
 * live NVAPI values (fetched only while this tab is mounted), a folder-override
 * input + picker, and a Save button (disabled until dirty) that applies DLLs +
 * presets + folder override in one `dlss_save_game` call.
 */
export function GameDetailDlssTab({ gameId }: GameDetailDlssTabProps): React.JSX.Element {
  React.useEffect(() => {
    logFrontend('info', 'DLSS detail tab mounted — fetching live preset state', {
      category: 'dlss.detail',
      gameId,
    })
  }, [gameId])

  const supportQuery = useDlssSupportQuery()
  const stateQuery = useDlssGameStateQuery(gameId)
  const catalogQuery = useDlssCatalogQuery()
  const downloadProgress = useDlssDownloadProgress()
  const saveGame = useSaveDlssGameMutation()

  const nvapiAvailable = supportQuery.data?.nvapiAvailable ?? false
  const srPresetQuery = useDlssGamePresetQuery(gameId, 'dlss', nvapiAvailable)
  const rrPresetQuery = useDlssGamePresetQuery(gameId, 'rayReconstruction', nvapiAvailable)
  const srPresetOptions = useDlssPresetOptionsQuery('dlss')
  const rrPresetOptions = useDlssPresetOptionsQuery('rayReconstruction')

  const state = stateQuery.data
  const catalog = catalogQuery.data

  // Detected versions seed the initial DLL selections.
  const detected = React.useMemo(
    () => ({
      superResolution: detectedVersion(state, 'superResolution') ?? null,
      frameGeneration: detectedVersion(state, 'frameGeneration') ?? null,
      rayReconstruction: detectedVersion(state, 'rayReconstruction') ?? null,
    }),
    [state]
  )

  // All controls track an "override" that is `undefined`/`null` until the user
  // edits it, deriving the displayed value from the (async) detected/live data.
  // This avoids seeding effects (forbidden by the set-state-in-effect lint rule)
  // while keeping the modal's per-open reset behaviour.
  const [versionOverrides, setVersionOverrides] = React.useState<
    Partial<Record<DllType, string | null>>
  >({})
  const [folderOverride, setFolderOverride] = React.useState<string | null>(null)
  const [srPresetOverride, setSrPresetOverride] = React.useState<number | null>(null)
  const [rrPresetOverride, setRrPresetOverride] = React.useState<number | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [folderError, setFolderError] = React.useState<string | null>(null)

  const selections: Record<DllType, string | null> = {
    superResolution:
      versionOverrides.superResolution !== undefined
        ? versionOverrides.superResolution
        : detected.superResolution,
    frameGeneration:
      versionOverrides.frameGeneration !== undefined
        ? versionOverrides.frameGeneration
        : detected.frameGeneration,
    rayReconstruction:
      versionOverrides.rayReconstruction !== undefined
        ? versionOverrides.rayReconstruction
        : detected.rayReconstruction,
  }

  const detectedFolder = state?.folderOverride ?? ''
  const folder = folderOverride ?? detectedFolder

  const srPresetValue = srPresetQuery.data?.value ?? 0
  const rrPresetValue = rrPresetQuery.data?.value ?? 0
  const srPreset = srPresetOverride ?? srPresetValue
  const rrPreset = rrPresetOverride ?? rrPresetValue

  const presetsAvailable =
    nvapiAvailable &&
    (srPresetQuery.data?.available === true || rrPresetQuery.data?.available === true)
  const presetsResolved = !nvapiAvailable || (!srPresetQuery.isLoading && !rrPresetQuery.isLoading)
  const showPresetCallout = nvapiAvailable && presetsResolved && !presetsAvailable
  const detectedSupport = {
    superResolution: detected.superResolution !== null,
    frameGeneration: detected.frameGeneration !== null,
    rayReconstruction: detected.rayReconstruction !== null,
  }
  const srPresetEnabled = detectedSupport.superResolution && srPresetQuery.data?.available === true
  const rrPresetEnabled =
    detectedSupport.rayReconstruction && rrPresetQuery.data?.available === true

  const trimmedFolder = folder.trim()
  const folderDirty = trimmedFolder !== detectedFolder
  const versionsDirty = DLL_TYPES.some((type) => selections[type] !== detected[type])
  const srPresetDirty =
    srPresetEnabled && srPresetOverride !== null && srPresetOverride !== srPresetValue
  const rrPresetDirty =
    rrPresetEnabled && rrPresetOverride !== null && rrPresetOverride !== rrPresetValue
  const isDirty = folderDirty || versionsDirty || srPresetDirty || rrPresetDirty

  function setSelection(type: DllType, version: string | null): void {
    setVersionOverrides((current) => ({ ...current, [type]: version }))
  }

  async function pickFolder(): Promise<void> {
    setFolderError(null)
    try {
      const result = await open({ directory: true, multiple: false, title: 'Select game folder' })
      const path = normalizeDialogPath(result)
      if (path) {
        setFolderOverride(path)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setFolderError(message.trim() ? message : 'Could not open the folder picker.')
      logFrontend('warn', 'Failed to open the DLSS folder picker.', {
        category: 'dlss.detail',
        details: message,
      })
    }
  }

  async function handleSave(): Promise<void> {
    const changes: SaveGameDlss = {}
    DLL_TYPES.forEach((type) => {
      if (selections[type] === detected[type]) {
        return
      }
      const selection: SaveGameDllSelection =
        selections[type] === null
          ? { mode: 'systemDefault' }
          : { mode: 'version', version: selections[type] }
      switch (type) {
        case 'superResolution':
          changes.sr = selection
          break
        case 'frameGeneration':
          changes.fg = selection
          break
        case 'rayReconstruction':
          changes.rr = selection
          break
      }
    })
    if (srPresetEnabled) {
      if (srPreset !== srPresetValue) {
        changes.srPreset = srPreset
      } else if (srPresetOverride !== null && srPreset === PRESET_DEFAULT_VALUE) {
        changes.srPreset = PRESET_DEFAULT_VALUE
      }
    }
    if (rrPresetEnabled) {
      if (rrPreset !== rrPresetValue) {
        changes.rrPreset = rrPreset
      } else if (rrPresetOverride !== null && rrPreset === PRESET_DEFAULT_VALUE) {
        changes.rrPreset = PRESET_DEFAULT_VALUE
      }
    }
    if (trimmedFolder) {
      changes.folderOverride = trimmedFolder
    }
    try {
      await saveGame.mutateAsync({ gameId, changes })
      toast('success', 'DLSS settings saved for this game.', { category: 'dlss.detail' })
    } catch (error: unknown) {
      if (isElevationError(error)) {
        showElevationToast(error instanceof Error ? error.message : String(error))
      } else {
        toastError('Could not save DLSS settings for this game', {
          category: 'dlss.detail',
          details: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }

  const canSave = isDirty && !busy && !saveGame.isPending

  return (
    <div className="mx-auto max-w-2xl space-y-8" data-testid="game-detail-dlss">
      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Detected versions
        </h3>
        <div className="space-y-2 rounded-[1.4rem] border border-border bg-background/70 p-4">
          {DLL_TYPES.map((type) => (
            <DetectedRow
              key={type}
              label={DLL_TYPE_LABELS[type]}
              version={detected[type] ?? undefined}
            />
          ))}
        </div>
      </section>

      <section className="space-y-4">
        {DLL_TYPES.map((type) => (
          <div key={type} className="space-y-2">
            <span className="block text-sm font-medium text-foreground">
              {DLL_TYPE_LABELS[type]}
            </span>
            <DllVersionCombobox
              dllType={type}
              versions={catalog ? catalog[CATALOG_KEY[type]] : []}
              value={selections[type]}
              onChange={(version) => setSelection(type, version)}
              label={DLL_TYPE_LABELS[type]}
              progress={downloadProgress.progress}
              onClearProgress={downloadProgress.clear}
              onBusyChange={setBusy}
              disabled={!detectedSupport[type]}
            />
          </div>
        ))}
        <p className="text-sm text-muted-foreground">
          Overrides the global setting for this game only.
        </p>
      </section>

      <section className="space-y-4">
        {showPresetCallout ? (
          <DlssUnsupportedCallout
            title="Presets unavailable"
            description="No NVIDIA driver profile matches this game, so per-game presets can't be set."
          />
        ) : null}
        <div className="space-y-2">
          <span className="block text-sm font-medium text-foreground">DLSS Preset</span>
          <PresetCombobox
            label="DLSS Preset"
            options={srPresetOptions.data ?? []}
            value={srPreset}
            onChange={setSrPresetOverride}
            disabled={!srPresetEnabled}
          />
        </div>
        <div className="space-y-2">
          <span className="block text-sm font-medium text-foreground">
            Ray Reconstruction Preset
          </span>
          <PresetCombobox
            label="Ray Reconstruction Preset"
            options={rrPresetOptions.data ?? []}
            value={rrPreset}
            onChange={setRrPresetOverride}
            disabled={!rrPresetEnabled}
          />
        </div>
      </section>

      <section className="space-y-2">
        <span className="block text-sm font-medium text-foreground">
          Game folder (optional override)
        </span>
        <div className="flex items-center gap-2">
          <Input
            value={folder}
            onChange={(event) => setFolderOverride(event.target.value)}
            placeholder="Auto-detected when possible"
            aria-label="Game folder override"
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => void pickFolder()}
            aria-label="Browse for game folder"
          >
            <Icon name="folder_open" className="text-[18px]" />
          </Button>
        </div>
        {folderError ? <p className="text-sm text-destructive">{folderError}</p> : null}
        <p className="text-sm text-muted-foreground">
          Auto-detected when possible. Override only if the scanner can't find the right folder.
        </p>
      </section>

      <div className="flex justify-end">
        <Button type="button" disabled={!canSave} onClick={() => void handleSave()}>
          {saveGame.isPending ? 'Saving…' : 'Save DLSS settings for this game'}
        </Button>
      </div>
    </div>
  )
}
