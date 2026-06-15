import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import { toCoverImageUrl } from '@/lib/asset-url'
import { logFrontend } from '@/lib/app-log-commands'
import { cacheArtCandidate, fetchMetadata, searchArt } from '@/lib/ipc/art-commands'
import { useCreateGameMutation } from '@/lib/queries/use-games'
import { cn } from '@/lib/utils'
import { useUiStore } from '@/stores/ui-store'
import type { ArtCandidate } from '@/types/domain'

type WizardStep = 1 | 2 | 3

interface WizardState {
  executablePath: string
  searchTerm: string
  selectedCandidate: ArtCandidate | null
  selectedImagePath: string | null
  selectedImagePreview: string | null
  selectedImageLabel: string | null
  canonicalName: string
  gameName: string
  argumentsValue: string
}

const INITIAL_STATE: WizardState = {
  executablePath: '',
  searchTerm: '',
  selectedCandidate: null,
  selectedImagePath: null,
  selectedImagePreview: null,
  selectedImageLabel: null,
  canonicalName: '',
  gameName: '',
  argumentsValue: '',
}

const ART_SEARCH_DEBOUNCE_MS = 400

/** Cap on cover candidates shown in the grid (plan B4: 12–16 results). */
const ART_RESULT_LIMIT = 16

const STEP_COPY: Record<WizardStep, { eyebrow: string; title: string; description: string }> = {
  1: {
    eyebrow: 'Step 1 of 3',
    title: 'Choose the game executable',
    description: 'Browse to the .exe you want Game Manager to launch.',
  },
  2: {
    eyebrow: 'Step 2 of 3',
    title: 'Pick cover art',
    description: 'Search cover candidates, move with the keyboard, or bring your own file.',
  },
  3: {
    eyebrow: 'Step 3 of 3',
    title: 'Confirm game details',
    description: 'Adjust the detected metadata and save the new library entry.',
  },
}

function resetWizardState(): WizardState {
  return { ...INITIAL_STATE }
}

function normalizeDialogPath(value: string | string[] | null): string | null {
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0] : null
  }
  return typeof value === 'string' ? value : null
}

function inferNameFromPath(path: string): string {
  const fileName = path.split(/[\\/]/).pop() ?? path
  const withoutExtension = fileName.replace(/\.[^.]+$/, '')
  return withoutExtension
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
}

function getArtDialogErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.trim() ? message : 'Could not open the file picker.'
}

export function AddGameWizard(): React.JSX.Element {
  const isOpen = useUiStore((state) => state.activeOverlay === 'wizard')
  const setActiveOverlay = useUiStore((state) => state.setActiveOverlay)
  const createGameMutation = useCreateGameMutation()

  const [step, setStep] = useState<WizardStep>(1)
  const [wizard, setWizard] = useState<WizardState>(resetWizardState)
  const [candidates, setCandidates] = useState<ArtCandidate[]>([])
  const [isSearchingArt, setIsSearchingArt] = useState(false)
  const [isPreparingArt, setIsPreparingArt] = useState(false)
  const [artError, setArtError] = useState<string | null>(null)
  const [browseError, setBrowseError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  const browseButtonRef = useRef<HTMLButtonElement | null>(null)
  const artSearchInputRef = useRef<HTMLInputElement | null>(null)
  const nameInputRef = useRef<HTMLInputElement | null>(null)
  const candidateRefs = useRef<Array<HTMLButtonElement | null>>([])
  const lastSearchTermRef = useRef<string | null>(null)
  const searchRequestIdRef = useRef(0)
  const stepCopy = STEP_COPY[step]
  const hasExecutable = wizard.executablePath.trim().length > 0
  const canContinueFromArt = Boolean(
    wizard.selectedCandidate || wizard.selectedImagePath || artError
  )

  const closeWizard = () => {
    setActiveOverlay('none')
    setStep(1)
    setWizard(resetWizardState())
    setCandidates([])
    setIsSearchingArt(false)
    setIsPreparingArt(false)
    setArtError(null)
    setBrowseError(null)
    setSaveError(null)
    lastSearchTermRef.current = null
  }

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const focusTarget = () => {
      if (step === 1) {
        browseButtonRef.current?.focus()
        return
      }

      if (step === 2) {
        artSearchInputRef.current?.focus()
        return
      }

      nameInputRef.current?.focus()
    }

    const timeoutId = window.setTimeout(focusTarget, 0)
    return () => window.clearTimeout(timeoutId)
  }, [isOpen, step])

  async function browseForExecutable(): Promise<void> {
    setBrowseError(null)

    try {
      const result = await open({
        title: 'Select game executable',
        directory: false,
        multiple: false,
        filters: [{ name: 'Applications', extensions: ['exe'] }],
      })

      const executablePath = normalizeDialogPath(result)
      if (!executablePath) {
        return
      }

      const inferredName = inferNameFromPath(executablePath)
      setWizard((current) => ({
        ...current,
        executablePath,
        searchTerm: inferredName,
        canonicalName: inferredName,
        gameName: inferredName,
        selectedCandidate: null,
        selectedImagePath: null,
        selectedImagePreview: null,
        selectedImageLabel: null,
      }))
    } catch (error) {
      const message = getArtDialogErrorMessage(error)
      setBrowseError(message)
      logFrontend('error', 'Failed to choose a game executable.', {
        category: 'games.wizard',
        details: message,
      })
    }
  }

  async function browseForLocalArt(): Promise<void> {
    setBrowseError(null)

    try {
      const result = await open({
        title: 'Select cover art',
        directory: false,
        multiple: false,
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
      })
      const imagePath = normalizeDialogPath(result)
      if (!imagePath) {
        return
      }

      setWizard((current) => ({
        ...current,
        selectedCandidate: null,
        selectedImagePath: imagePath,
        selectedImagePreview: imagePath,
        selectedImageLabel: imagePath.split(/[\\/]/).pop() ?? imagePath,
      }))
      setArtError(null)
    } catch (error) {
      const message = getArtDialogErrorMessage(error)
      setBrowseError(message)
      logFrontend('error', 'Failed to choose a local cover file.', {
        category: 'games.wizard',
        details: message,
      })
    }
  }

  async function runArtSearch(nextSearchTerm?: string): Promise<void> {
    const term = (nextSearchTerm ?? wizard.searchTerm).trim()
    if (!term) {
      setCandidates([])
      setArtError('Enter a game name before searching for art.')
      return
    }

    const requestId = ++searchRequestIdRef.current
    setIsSearchingArt(true)
    setArtError(null)
    setBrowseError(null)
    lastSearchTermRef.current = term

    try {
      const [artResult, metadataResult] = await Promise.allSettled([
        searchArt(term),
        fetchMetadata(term),
      ])

      // Drop stale responses: a newer search started while this one was in flight.
      if (searchRequestIdRef.current !== requestId) {
        return
      }

      if (metadataResult.status === 'fulfilled') {
        setWizard((current) => ({
          ...current,
          canonicalName: metadataResult.value.canonicalName,
          gameName:
            current.gameName.trim().length > 0 &&
            current.gameName.trim() !== current.canonicalName.trim()
              ? current.gameName
              : metadataResult.value.canonicalName,
        }))
      } else {
        logFrontend('warn', 'Metadata lookup failed during Add Game art search.', {
          category: 'games.wizard',
          details: String(metadataResult.reason),
        })
      }

      if (artResult.status === 'rejected') {
        setCandidates([])
        setArtError('Could not reach art providers. You can retry or use a local file instead.')
        logFrontend('warn', 'Art search failed during Add Game wizard.', {
          category: 'games.wizard',
          details: String(artResult.reason),
        })
        return
      }

      const limitedCandidates = artResult.value.slice(0, ART_RESULT_LIMIT)
      setCandidates(limitedCandidates)

      setWizard((current) => {
        const selectedStillExists = current.selectedCandidate
          ? limitedCandidates.some((candidate) => candidate.id === current.selectedCandidate?.id)
          : false

        return selectedStillExists
          ? current
          : {
              ...current,
              selectedCandidate: limitedCandidates[0] ?? null,
              selectedImagePath: current.selectedImagePath,
              selectedImagePreview: limitedCandidates[0]?.imageUrl ?? current.selectedImagePreview,
              selectedImageLabel:
                limitedCandidates[0] != null
                  ? limitedCandidates[0].providerName
                  : current.selectedImageLabel,
            }
      })

      if (limitedCandidates.length === 0) {
        setArtError('No cover art matched this search. Try another title or use a local file.')
      }
    } finally {
      if (searchRequestIdRef.current === requestId) {
        setIsSearchingArt(false)
      }
    }
  }

  const runArtSearchEvent = useEffectEvent((term?: string) => {
    void runArtSearch(term)
  })

  useEffect(() => {
    if (!isOpen || step !== 2) {
      return
    }

    const term = wizard.searchTerm.trim()
    if (!term || lastSearchTermRef.current === term) {
      return
    }

    const delay = lastSearchTermRef.current === null ? 0 : ART_SEARCH_DEBOUNCE_MS
    const timeoutId = window.setTimeout(() => {
      runArtSearchEvent(term)
    }, delay)

    return () => window.clearTimeout(timeoutId)
  }, [isOpen, step, wizard.searchTerm])

  function moveCandidateFocus(index: number): void {
    if (candidates.length === 0) {
      return
    }

    const bounded = Math.max(0, Math.min(index, candidates.length - 1))
    setWizard((current) => ({
      ...current,
      selectedCandidate: candidates[bounded],
      selectedImagePath: null,
      selectedImagePreview: candidates[bounded].imageUrl,
      selectedImageLabel: candidates[bounded].providerName,
    }))
    candidateRefs.current[bounded]?.focus()
  }

  function handleCandidateKeyDown(
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number
  ): void {
    const columns = 4
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault()
        moveCandidateFocus(index + 1)
        break
      case 'ArrowLeft':
        event.preventDefault()
        moveCandidateFocus(index - 1)
        break
      case 'ArrowDown':
        event.preventDefault()
        moveCandidateFocus(index + columns)
        break
      case 'ArrowUp':
        event.preventDefault()
        moveCandidateFocus(index - columns)
        break
      case 'Home':
        event.preventDefault()
        moveCandidateFocus(0)
        break
      case 'End':
        event.preventDefault()
        moveCandidateFocus(candidates.length - 1)
        break
      case ' ':
      case 'Enter':
        event.preventDefault()
        moveCandidateFocus(index)
        break
      default:
        break
    }
  }

  async function continueFromArt(): Promise<void> {
    setSaveError(null)

    if (wizard.selectedCandidate) {
      setIsPreparingArt(true)
      try {
        const cachedPath = await cacheArtCandidate(wizard.selectedCandidate.imageUrl)
        if (!cachedPath) {
          setArtError(
            'Could not cache the selected cover art. Try another image or use a local file.'
          )
          logFrontend('warn', 'Cover art caching returned no cached path in Add Game wizard.', {
            category: 'games.wizard',
            details: wizard.selectedCandidate.imageUrl,
          })
          setIsPreparingArt(false)
          return
        }
        setWizard((current) => ({
          ...current,
          selectedImagePath: cachedPath,
          selectedImagePreview: cachedPath,
          selectedImageLabel: wizard.selectedCandidate?.providerName ?? current.selectedImageLabel,
        }))
      } catch (error) {
        const details = error instanceof Error ? error.message : String(error)
        setArtError(
          'Could not cache the selected cover art. Try another image or use a local file.'
        )
        logFrontend('warn', 'Cover art caching failed in Add Game wizard.', {
          category: 'games.wizard',
          details,
        })
        setIsPreparingArt(false)
        return
      }
      setIsPreparingArt(false)
    }

    setStep(3)
  }

  async function saveGame(): Promise<void> {
    setSaveError(null)
    try {
      await createGameMutation.mutateAsync({
        name: wizard.gameName.trim(),
        launchTarget: wizard.executablePath.trim(),
        monitorMode: 'tree',
        arguments: wizard.argumentsValue.trim() || null,
        imagePath: wizard.selectedImagePath,
      })
      closeWizard()
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error)
      setSaveError('Could not save the game right now. Check the details and try again.')
      logFrontend('error', 'Failed to create a game from the Add Game wizard.', {
        category: 'games.wizard',
        details,
      })
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(nextOpen) => (!nextOpen ? closeWizard() : undefined)}>
      <DialogContent
        className="flex max-h-[90vh] max-w-2xl flex-col gap-0 overflow-hidden p-0"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <div className="shrink-0 border-b border-border bg-surface-low px-6 py-5">
          <DialogHeader className="gap-3">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p
                  aria-live="polite"
                  aria-atomic="true"
                  className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground"
                >
                  {stepCopy.eyebrow}
                </p>
                <DialogTitle className="mt-2 text-2xl">{stepCopy.title}</DialogTitle>
              </div>
              <div className="flex items-center gap-2" aria-hidden="true">
                {[1, 2, 3].map((value) => (
                  <div
                    key={value}
                    className={cn(
                      'h-2.5 w-12 rounded-full bg-surface-high',
                      value <= step && 'bg-primary'
                    )}
                  />
                ))}
              </div>
            </div>
            <DialogDescription>{stepCopy.description}</DialogDescription>
          </DialogHeader>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
          <ol className="mb-5 flex items-center gap-3 text-sm" aria-label="Wizard progress">
            {(Object.entries(STEP_COPY) as Array<[string, (typeof STEP_COPY)[WizardStep]]>).map(
              ([value, copy]) => {
                const numericStep = Number(value) as WizardStep
                const isCurrent = step === numericStep
                const isComplete = step > numericStep

                return (
                  <li
                    key={value}
                    className={cn(
                      'flex items-center gap-2 rounded-full border px-3 py-1.5',
                      isCurrent
                        ? 'border-primary bg-primary/10 text-foreground'
                        : 'border-border bg-surface-low text-muted-foreground'
                    )}
                    aria-current={isCurrent ? 'step' : undefined}
                  >
                    <span
                      className={cn(
                        'flex h-6 w-6 items-center justify-center rounded-full border text-xs font-semibold',
                        isComplete
                          ? 'border-primary bg-primary text-primary-foreground'
                          : isCurrent
                            ? 'border-primary text-primary'
                            : 'border-border'
                      )}
                    >
                      {isComplete ? <Icon name="check" className="text-[14px]" /> : value}
                    </span>
                    <span>{copy.title}</span>
                  </li>
                )
              }
            )}
          </ol>

          {step === 1 ? (
            <section className="space-y-4" data-testid="add-game-step-1">
              <div className="rounded-2xl border border-border bg-surface-low p-5">
                <p className="text-sm text-muted-foreground">
                  Pick the Windows executable that should launch when you press Play.
                </p>
                <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
                  <Button
                    type="button"
                    onClick={() => void browseForExecutable()}
                    ref={browseButtonRef}
                  >
                    <Icon name="folder_open" className="text-[18px]" />
                    Browse for executable
                  </Button>
                  <div className="min-w-0 flex-1 rounded-xl border border-border bg-background px-4 py-3 text-sm text-foreground">
                    {hasExecutable ? wizard.executablePath : 'No executable selected yet.'}
                  </div>
                </div>
              </div>

              {browseError ? (
                <p className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  {browseError}
                </p>
              ) : null}

              <DialogFooter>
                <Button type="button" variant="ghost" onClick={closeWizard}>
                  Cancel
                </Button>
                <Button type="button" onClick={() => setStep(2)} disabled={!hasExecutable}>
                  Continue to cover art
                </Button>
              </DialogFooter>
            </section>
          ) : null}

          {step === 2 ? (
            <section className="space-y-5" data-testid="add-game-step-2">
              <div className="flex flex-col gap-3 rounded-2xl border border-border bg-surface-low p-5">
                <div className="flex flex-col gap-3 sm:flex-row">
                  <div className="flex-1 space-y-2">
                    <label
                      htmlFor="cover-search"
                      className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground"
                    >
                      Search title
                    </label>
                    <Input
                      id="cover-search"
                      ref={artSearchInputRef}
                      value={wizard.searchTerm}
                      onChange={(event) =>
                        setWizard((current) => ({ ...current, searchTerm: event.target.value }))
                      }
                    />
                  </div>
                  <div className="flex items-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void runArtSearch()}
                      disabled={isSearchingArt}
                    >
                      <Icon name="search" className="text-[18px]" />
                      {isSearchingArt ? 'Searching…' : 'Search'}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void browseForLocalArt()}
                    >
                      <Icon name="image" className="text-[18px]" />
                      Use Local File
                    </Button>
                  </div>
                </div>

                <p className="text-sm text-muted-foreground">
                  Search started from{' '}
                  <span className="font-medium text-foreground">{wizard.executablePath}</span>
                </p>
              </div>

              {artError ? (
                <div className="rounded-2xl border border-border bg-surface-low p-5">
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <Icon
                        name={candidates.length === 0 && isSearchingArt ? 'sync' : 'wifi_off'}
                        className="text-[22px]"
                      />
                    </span>
                    <div className="space-y-2">
                      <h3 className="font-heading text-lg font-semibold text-foreground">
                        {candidates.length === 0
                          ? 'Art search needs a fallback'
                          : 'Art search updated'}
                      </h3>
                      <p className="text-sm text-muted-foreground">{artError}</p>
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" variant="outline" onClick={() => void runArtSearch()}>
                          Retry search
                        </Button>
                        <Button type="button" variant="ghost" onClick={() => setStep(3)}>
                          Continue without cover
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              {wizard.selectedImagePath && !wizard.selectedCandidate ? (
                <div className="rounded-2xl border border-primary/40 bg-primary/10 px-4 py-3 text-sm text-foreground">
                  Local cover selected: {wizard.selectedImageLabel}
                </div>
              ) : null}

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-heading text-lg font-semibold">Cover candidates</h3>
                  <span className="text-sm text-muted-foreground">
                    {isSearchingArt
                      ? 'Searching…'
                      : `${candidates.length} result${candidates.length === 1 ? '' : 's'}`}
                  </span>
                </div>

                {candidates.length > 0 ? (
                  <div
                    className="grid grid-cols-2 gap-3 md:grid-cols-4"
                    role="listbox"
                    aria-label="Cover art candidates"
                    data-testid="art-candidate-grid"
                  >
                    {candidates.map((candidate, index) => {
                      const selected = wizard.selectedCandidate?.id === candidate.id
                      return (
                        <button
                          key={candidate.id}
                          ref={(node) => {
                            candidateRefs.current[index] = node
                          }}
                          type="button"
                          role="option"
                          aria-selected={selected}
                          tabIndex={selected || index === 0 ? 0 : -1}
                          className={cn(
                            'group overflow-hidden rounded-2xl border bg-card text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                            selected
                              ? 'border-primary shadow-[0_0_0_1px_hsl(var(--primary))]'
                              : 'border-border'
                          )}
                          onClick={() => moveCandidateFocus(index)}
                          onKeyDown={(event) => handleCandidateKeyDown(event, index)}
                        >
                          <div className="aspect-3/4 overflow-hidden bg-surface-high">
                            <img
                              src={candidate.imageUrl}
                              alt={`${wizard.gameName || wizard.searchTerm} cover option ${index + 1}`}
                              className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                            />
                          </div>
                          <div className="space-y-1 p-3">
                            <p className="text-sm font-semibold text-foreground">
                              {candidate.providerName}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {candidate.width} × {candidate.height}
                            </p>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                ) : !isSearchingArt ? (
                  <div className="rounded-2xl border border-dashed border-border bg-surface-low px-5 py-8 text-center text-sm text-muted-foreground">
                    Start a search or use a local file to continue.
                  </div>
                ) : null}
              </div>

              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setStep(1)}>
                  Back
                </Button>
                <Button
                  type="button"
                  onClick={() => void continueFromArt()}
                  disabled={!canContinueFromArt || isPreparingArt}
                >
                  {isPreparingArt ? 'Preparing cover…' : 'Continue to details'}
                </Button>
              </DialogFooter>
            </section>
          ) : null}

          {step === 3 ? (
            <section className="space-y-5" data-testid="add-game-step-3">
              <div className="grid gap-5 md:grid-cols-[12rem_1fr]">
                <div className="rounded-2xl border border-border bg-surface-low p-4">
                  <div className="flex aspect-3/4 items-center justify-center overflow-hidden rounded-xl bg-background">
                    {toCoverImageUrl(wizard.selectedImagePreview) ? (
                      <img
                        src={toCoverImageUrl(wizard.selectedImagePreview) ?? undefined}
                        alt={`${wizard.gameName || wizard.canonicalName || 'Selected'} cover preview`}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="space-y-2 px-4 text-center text-muted-foreground">
                        <Icon name="photo" className="mx-auto text-[34px]" />
                        <p className="text-sm">No cover selected</p>
                      </div>
                    )}
                  </div>
                  <p className="mt-3 text-xs uppercase tracking-[0.18em] text-muted-foreground">
                    {wizard.selectedImageLabel ?? 'No image source'}
                  </p>
                </div>

                <div className="space-y-4 rounded-2xl border border-border bg-surface-low p-5">
                  <div className="space-y-2">
                    <label
                      htmlFor="game-name"
                      className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground"
                    >
                      Game name
                    </label>
                    <Input
                      id="game-name"
                      ref={nameInputRef}
                      value={wizard.gameName}
                      onChange={(event) =>
                        setWizard((current) => ({ ...current, gameName: event.target.value }))
                      }
                    />
                  </div>

                  <div className="space-y-2">
                    <label
                      htmlFor="launch-target"
                      className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground"
                    >
                      Launch target
                    </label>
                    <Input
                      id="launch-target"
                      value={wizard.executablePath}
                      onChange={(event) =>
                        setWizard((current) => ({ ...current, executablePath: event.target.value }))
                      }
                    />
                  </div>

                  <div className="space-y-2">
                    <label
                      htmlFor="launch-arguments"
                      className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground"
                    >
                      Launch arguments
                    </label>
                    <Input
                      id="launch-arguments"
                      placeholder="Optional command line arguments"
                      value={wizard.argumentsValue}
                      onChange={(event) =>
                        setWizard((current) => ({ ...current, argumentsValue: event.target.value }))
                      }
                    />
                  </div>

                  <div className="rounded-xl border border-border bg-background px-4 py-3 text-sm text-muted-foreground">
                    Monitor mode will start as{' '}
                    <span className="font-medium text-foreground">tree</span>. Launcher-specific
                    monitoring lands in the edit modal next.
                  </div>
                </div>
              </div>

              {saveError ? (
                <p className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  {saveError}
                </p>
              ) : null}

              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setStep(2)}>
                  Back
                </Button>
                <Button
                  type="button"
                  onClick={() => void saveGame()}
                  disabled={wizard.gameName.trim().length === 0 || createGameMutation.isPending}
                >
                  {createGameMutation.isPending ? 'Saving…' : 'Save game'}
                </Button>
              </DialogFooter>
            </section>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
