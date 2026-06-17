import * as React from 'react'

import { Combobox, type ComboboxOption } from '@/components/ui/combobox'
import { Icon } from '@/components/ui/icon'
import { toastError } from '@/lib/app-log-commands'
import { downloadKey, useDownloadDlssVersionMutation } from '@/lib/queries/use-dlss'
import type { DllType, DllVersion, DownloadProgress } from '@/types/dlss'

import {
  buildVersionOptions,
  findVersion,
  formatApproxSize,
  SYSTEM_DEFAULT_VALUE,
  VERSION_GROUPS,
} from './dll-version-options'
import { isElevationError, showElevationToast } from './elevation-toast'

export interface DllVersionComboboxProps {
  /** The DLL type this picker manages. */
  dllType: DllType
  /** Catalog versions for this type (newest first). */
  versions: DllVersion[]
  /** Selected display version, or `null` for System Default. */
  value: string | null
  /** Called with the new selection (display version, or `null` for System Default). */
  onChange: (version: string | null) => void
  /** Accessible label for the trigger. */
  label: string
  /** Latest download progress for this `(type, version)`, when downloading. */
  progress?: Record<string, DownloadProgress>
  /** Clear a completed/errored progress entry. */
  onClearProgress?: (dllType: DllType, version: string) => void
  /** Notify the parent when a download starts/finishes (for disabling Apply). */
  onBusyChange?: (busy: boolean) => void
  /** Disable the control. */
  disabled?: boolean
}

/**
 * Version picker grouping options into System Default / Downloaded / Available
 * (with a download icon + approximate size). Selecting a not-yet-downloaded
 * version triggers a download with inline progress in the trigger; selection is
 * deferred until the download succeeds. Errors surface via toast (privilege
 * failures route to the elevation toast).
 */
export function DllVersionCombobox({
  dllType,
  versions,
  value,
  onChange,
  label,
  progress,
  onClearProgress,
  onBusyChange,
  disabled = false,
}: DllVersionComboboxProps): React.JSX.Element {
  const download = useDownloadDlssVersionMutation()
  const [downloadingVersion, setDownloadingVersion] = React.useState<string | null>(null)

  const baseOptions = buildVersionOptions(versions)
  const options: ComboboxOption[] = baseOptions.map((option) => {
    if (option.group !== VERSION_GROUPS.available) {
      return option
    }
    const version = findVersion(versions, option.value)
    const size = version ? formatApproxSize(version.zipSizeBytes) : ''
    return {
      ...option,
      trailing: (
        <>
          <Icon name="download" className="text-[14px]" />
          {size ? <span>{size}</span> : null}
        </>
      ),
    }
  })

  const selectedValue = value === null ? SYSTEM_DEFAULT_VALUE : value

  const active = downloadingVersion
    ? progress?.[downloadKey(dllType, downloadingVersion)]
    : undefined
  const percent =
    active && active.totalBytes > 0
      ? Math.min(100, Math.round((active.downloadedBytes / active.totalBytes) * 100))
      : null
  const progressNode =
    downloadingVersion !== null
      ? `Downloading ${downloadingVersion}…${percent !== null ? ` ${percent}%` : ''}`
      : undefined

  function setBusy(version: string | null): void {
    setDownloadingVersion(version)
    onBusyChange?.(version !== null)
  }

  function handleSelect(selected: string): void {
    if (selected === SYSTEM_DEFAULT_VALUE) {
      onChange(null)
      return
    }
    const version = findVersion(versions, selected)
    if (version && !version.isDownloaded) {
      void startDownload(version)
      return
    }
    onChange(selected)
  }

  async function startDownload(version: DllVersion): Promise<void> {
    setBusy(version.version)
    try {
      await download.mutateAsync({ dllType, version: version.version })
      onChange(version.version)
    } catch (error: unknown) {
      if (isElevationError(error)) {
        showElevationToast(error instanceof Error ? error.message : String(error))
      } else {
        toastError(`Could not download ${version.label}`, {
          category: 'dlss.download',
          details: error instanceof Error ? error.message : String(error),
        })
      }
    } finally {
      onClearProgress?.(dllType, version.version)
      setBusy(null)
    }
  }

  return (
    <Combobox
      label={label}
      options={options}
      value={selectedValue}
      onChange={handleSelect}
      placeholder="System Default"
      disabled={disabled}
      progress={progressNode}
    />
  )
}
