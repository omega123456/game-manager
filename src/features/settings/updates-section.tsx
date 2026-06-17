import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { APP_VERSION } from '@/lib/app-version'
import { cn } from '@/lib/utils'
import { useUpdateStore } from '@/stores/update-store'

import { SettingsSection } from './settings-section'

function StatusPill({
  className,
  icon,
  children,
}: {
  className: string
  icon: string
  children: ReactNode
}): React.JSX.Element {
  return (
    <div className={cn('inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm', className)}>
      <Icon name={icon} className="text-[18px]" />
      <span>{children}</span>
    </div>
  )
}

/**
 * Update management section. Shows the installed version, lets the user perform
 * a manual check, and drives download/restart actions for the Tauri updater.
 */
export function UpdatesSection(): React.JSX.Element {
  const status = useUpdateStore((state) => state.status)
  const availableVersion = useUpdateStore((state) => state.availableVersion)
  const downloadProgress = useUpdateStore((state) => state.downloadProgress)
  const errorMessage = useUpdateStore((state) => state.errorMessage)
  const checkForUpdate = useUpdateStore((state) => state.checkForUpdate)
  const downloadAndInstall = useUpdateStore((state) => state.downloadAndInstall)
  const restartToApplyUpdate = useUpdateStore((state) => state.restartToApplyUpdate)

  function renderStatus(): React.ReactNode {
    switch (status) {
      case 'checking':
        return (
          <StatusPill className="bg-secondary text-secondary-foreground" icon="progress_activity">
            Checking for updates...
          </StatusPill>
        )
      case 'up-to-date':
        return (
          <StatusPill className="bg-primary/10 text-primary" icon="verified">
            You are up to date.
          </StatusPill>
        )
      case 'available':
        return (
          <StatusPill className="bg-primary/10 text-primary" icon="system_update_alt">
            Version {availableVersion ?? 'new'} is available.
          </StatusPill>
        )
      case 'installing':
        return (
          <div className="space-y-2" data-testid="updates-installing-card">
            <StatusPill className="bg-secondary text-secondary-foreground" icon="download">
              Downloading version {availableVersion ?? 'update'}...
            </StatusPill>
            <div className="h-2 overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full rounded-full bg-primary transition-[width]"
                style={{ width: `${downloadProgress}%` }}
              />
            </div>
            <p
              className="text-sm text-muted-foreground"
              data-testid="updates-progress-text"
            >{`${downloadProgress}% downloaded`}</p>
          </div>
        )
      case 'ready-to-restart':
        return (
          <div className="space-y-2">
            <StatusPill className="bg-primary/10 text-primary" icon="download_done">
              Update downloaded. Restart Game Manager to finish installing version{' '}
              {availableVersion ?? 'the latest release'}.
            </StatusPill>
            {errorMessage ? (
              <p className="text-sm text-destructive" data-testid="updates-restart-error">
                Restart failed: {errorMessage}
              </p>
            ) : null}
          </div>
        )
      case 'error':
        return (
          <StatusPill className="bg-destructive/10 text-destructive" icon="error">
            {errorMessage ?? 'Update check failed.'}
          </StatusPill>
        )
      case 'idle':
      default:
        return (
          <StatusPill className="bg-secondary text-secondary-foreground" icon="info">
            Check for new Game Manager releases from GitHub.
          </StatusPill>
        )
    }
  }

  return (
    <SettingsSection
      icon="system_update_alt"
      title="Updates"
      description="Check for new versions and install them from the built-in updater."
    >
      <div className="space-y-4" data-testid="settings-updates">
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border bg-background/60 px-4 py-3">
          <div className="space-y-1">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Current version
            </p>
            <p
              className="font-mono text-sm font-semibold text-foreground"
              data-testid="updates-app-version"
            >
              v{APP_VERSION}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {status === 'available' ? (
              <Button
                type="button"
                onClick={() => void downloadAndInstall()}
                data-testid="updates-install-button"
              >
                Update now
              </Button>
            ) : null}
            {status === 'ready-to-restart' ? (
              <Button
                type="button"
                onClick={() => void restartToApplyUpdate()}
                data-testid="updates-restart-button"
              >
                Restart to update
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              disabled={status === 'checking' || status === 'installing'}
              onClick={() => void checkForUpdate(true)}
              data-testid="updates-check-button"
            >
              {status === 'checking' ? 'Checking...' : 'Check for updates'}
            </Button>
          </div>
        </div>

        <div className="space-y-2" data-testid="updates-status">
          {renderStatus()}
        </div>
      </div>
    </SettingsSection>
  )
}
