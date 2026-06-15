import type { PlaywrightFixtureHandler } from './index'

function getWizardDialogFixture(): 'default' | 'local-art' {
  if (typeof window === 'undefined') {
    return 'default'
  }

  const [, search = ''] = window.location.hash.split('?')
  const params = new URLSearchParams(search)
  return params.get('dialogFixture') === 'local-art' ? 'local-art' : 'default'
}

export const dialogFixtures: Record<string, PlaywrightFixtureHandler> = {
  'plugin:dialog|open': (args) => {
    const options = (args?.options ?? {}) as {
      filters?: Array<{ extensions?: string[] }>
    }
    const extensions = options.filters?.flatMap((filter) => filter.extensions ?? []) ?? []

    if (extensions.includes('exe')) {
      return 'C:/Games/AlanWake2.exe'
    }

    if (extensions.some((extension) => ['png', 'jpg', 'jpeg', 'webp'].includes(extension))) {
      if (getWizardDialogFixture() === 'local-art') {
        return 'C:/Users/Test/Pictures/custom-cover.png'
      }
      return 'C:/Users/Test/Pictures/fallback-cover.png'
    }

    return null
  },
}
