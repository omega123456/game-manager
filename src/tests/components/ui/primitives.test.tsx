import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Icon } from '@/components/ui/icon'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

describe('ui primitives', () => {
  it('Button renders variants and supports asChild', () => {
    const { rerender } = render(
      <Button variant="secondary" size="lg">
        Save
      </Button>
    )
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
    rerender(
      <Button asChild>
        <a href="/x">Link</a>
      </Button>
    )
    expect(screen.getByRole('link', { name: 'Link' })).toBeInTheDocument()
  })

  it('Input and Icon render', () => {
    render(
      <div>
        <Input aria-label="field" placeholder="type" />
        <Icon name="check" aria-label="checked" />
      </div>
    )
    expect(screen.getByRole('textbox', { name: 'field' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'checked' })).toBeInTheDocument()
  })

  it('Icon is decorative by default and supports filled', () => {
    const { container } = render(<Icon name="star" filled />)
    const span = container.querySelector('.material-symbols-rounded') as HTMLElement
    expect(span).toHaveAttribute('aria-hidden', 'true')
    expect(span.style.fontVariationSettings).toContain("'FILL' 1")
  })

  it('Switch toggles', async () => {
    const user = userEvent.setup()
    render(<Switch aria-label="toggle" />)
    const sw = screen.getByRole('switch', { name: 'toggle' })
    expect(sw).toHaveAttribute('aria-checked', 'false')
    await user.click(sw)
    expect(sw).toHaveAttribute('aria-checked', 'true')
  })

  it('Tabs switch content', async () => {
    const user = userEvent.setup()
    render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">A</TabsTrigger>
          <TabsTrigger value="b">B</TabsTrigger>
        </TabsList>
        <TabsContent value="a">Panel A</TabsContent>
        <TabsContent value="b">Panel B</TabsContent>
      </Tabs>
    )
    expect(screen.getByText('Panel A')).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'B' }))
    expect(await screen.findByText('Panel B')).toBeInTheDocument()
  })

  it('Dialog opens with header/footer parts', async () => {
    const user = userEvent.setup()
    render(
      <Dialog>
        <DialogTrigger>Open</DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Title</DialogTitle>
            <DialogDescription>Desc</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose>Close</DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
    await user.click(screen.getByRole('button', { name: 'Open' }))
    expect(await screen.findByText('Title')).toBeInTheDocument()
    expect(screen.getByText('Desc')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByText('Title')).not.toBeInTheDocument())
  })

  it('AlertDialog opens and cancels', async () => {
    const user = userEvent.setup()
    render(
      <AlertDialog>
        <AlertDialogTrigger>Delete</AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sure?</AlertDialogTitle>
            <AlertDialogDescription>Cannot undo</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>No</AlertDialogCancel>
            <AlertDialogAction>Yes</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    )
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(await screen.findByText('Sure?')).toBeInTheDocument()
    expect(screen.getByText('Cannot undo')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'No' }))
    await waitFor(() => expect(screen.queryByText('Sure?')).not.toBeInTheDocument())
  })

  it('Select opens and picks an option', async () => {
    const user = userEvent.setup()
    render(
      <Select defaultValue="recent">
        <SelectTrigger aria-label="Sort">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value="recent">Recent</SelectItem>
            <SelectItem value="name">Name</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    )
    const trigger = screen.getByRole('combobox', { name: 'Sort' })
    expect(trigger).toHaveTextContent('Recent')
    await user.click(trigger)
    await user.click(await screen.findByRole('option', { name: 'Name' }))
    await waitFor(() => expect(trigger).toHaveTextContent('Name'))
  })

  it('Command filters items and shows empty state', async () => {
    const user = userEvent.setup()
    render(
      <Command>
        <CommandInput placeholder="search" />
        <CommandList>
          <CommandEmpty>No results</CommandEmpty>
          <CommandGroup>
            <CommandItem value="alpha">Alpha</CommandItem>
            <CommandItem value="beta">Beta</CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    )
    expect(screen.getByText('Alpha')).toBeInTheDocument()
    await user.type(screen.getByPlaceholderText('search'), 'zzz')
    expect(await screen.findByText('No results')).toBeInTheDocument()
  })

  it('Tooltip renders content on hover', async () => {
    const user = userEvent.setup()
    render(
      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger>Hover</TooltipTrigger>
          <TooltipContent>Tip text</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
    await user.hover(screen.getByText('Hover'))
    expect(await screen.findAllByText('Tip text')).not.toHaveLength(0)
  })
})
