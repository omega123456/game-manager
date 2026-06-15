import { Icon } from '@/components/ui/icon'
import { Button } from '@/components/ui/button'

/**
 * Static shell for the "currently playing" hero. Live state and controls are
 * added later when the launch lifecycle exists.
 */
export function CurrentlyPlayingHero(): React.JSX.Element {
  return (
    <section className="relative overflow-hidden rounded-[1.75rem] border border-border bg-surface-container p-6">
      <div className="absolute inset-x-0 top-0 h-24 bg-linear-to-r from-primary/20 via-secondary/10 to-transparent" />
      <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-2xl space-y-4">
          <span className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-primary">
            <Icon name="play_circle" className="text-[16px]" />
            Currently Playing
          </span>
          <div className="space-y-2">
            <h1 className="font-heading text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
              Your launch deck lives here.
            </h1>
            <p className="max-w-xl text-sm text-muted-foreground sm:text-base">
              Phase B2 ships the library shell now. Live launch status, elapsed time, and controls
              connect in the later launch phases.
            </p>
          </div>
        </div>

        <div className="grid gap-3 rounded-2xl border border-border bg-surface-low p-4 sm:min-w-80 sm:grid-cols-2">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
              Active game
            </p>
            <p className="mt-2 font-heading text-xl font-bold text-foreground">No session active</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
              Session timer
            </p>
            <p className="mt-2 font-mono text-xl font-semibold text-foreground">00:00:00</p>
          </div>
          <Button type="button" variant="secondary" disabled className="sm:col-span-2 sm:w-fit">
            <Icon name="radio_button_checked" className="text-[18px]" />
            Launch state arrives in Phase E2
          </Button>
        </div>
      </div>
    </section>
  )
}
