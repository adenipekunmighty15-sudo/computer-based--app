import type { ReactNode } from 'react'
import { Button, Modal } from '../ui'

/* The one dialog that blocks. Destructive actions go through it, always with
   the specific noun in the body — "This paper and its 34 results" — so nobody
   confirms a delete without knowing what they are deleting. */
export function ConfirmDialog({
  title,
  body,
  detail,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  busy,
  onConfirm,
  onCancel,
}: {
  title: string
  body: string
  detail?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Modal
      open
      onClose={onCancel}
      title={title}
      tone="danger"
      width={460}
      actions={
        <>
          <Button variant="quiet" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant="danger" onClick={onConfirm} loading={busy}>
            {busy ? 'Working' : confirmLabel}
          </Button>
        </>
      }
    >
      <p>{body}</p>
      {detail ? <div className="stack stack-sm">{detail}</div> : null}
    </Modal>
  )
}
