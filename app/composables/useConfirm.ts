import { ConfirmModal, PromptModal } from '#components'

export interface ConfirmOptions {
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  color?: 'error' | 'primary' | 'warning' | 'neutral'
}

export interface PromptOptions {
  title: string
  description?: string
  label?: string
  initial?: string
  confirmLabel?: string
  maxlength?: number
  validate?: (value: string) => string | undefined
}

/** In-app replacement for window.confirm(): resolves true only when the user confirms. */
export function useConfirm() {
  const choose = useChoice()
  return async (options: ConfirmOptions): Promise<boolean> => (await choose(options)) === true
}

/** Two-answer question: true for the confirm button, false for the cancel button, null when dismissed. */
// A fresh overlay per call: destroyOnClose removes it from useOverlay's list once closed, so a
// shared instance would throw "Overlay not found" on the second open.
export function useChoice() {
  const overlay = useOverlay()
  return async (options: ConfirmOptions): Promise<boolean | null> =>
    (await overlay.create(ConfirmModal, { destroyOnClose: true }).open(options).result) ?? null
}

/** In-app replacement for window.prompt(): the entered text, or null when cancelled. */
export function usePrompt() {
  const overlay = useOverlay()
  return async (options: PromptOptions): Promise<string | null> =>
    (await overlay.create(PromptModal, { destroyOnClose: true }).open(options).result) ?? null
}
