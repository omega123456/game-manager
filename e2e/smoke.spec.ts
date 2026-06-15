import { expect, test } from '@playwright/test'

import { gotoApp } from './helpers'

test('app shell loads in the VITE_PLAYWRIGHT web build', async ({ page }) => {
  await gotoApp(page)
  await expect(page.getByTestId('app-root')).toBeVisible()
  await expect(page.getByText('Game Manager')).toBeVisible()
})
