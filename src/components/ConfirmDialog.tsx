import { useEffect, useId, useRef } from 'react';
import { FiAlertTriangle, FiX } from 'react-icons/fi';

/** Confirmation accessible : remplace window.confirm (non stylable,
 *  non testable). Focus piégé, Échap, clic sur le fond, ARIA dialog.
 *  Structure DaisyUI : <dialog class="modal"> + modal-box + modal-backdrop. */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirmer',
  cancelLabel = 'Annuler',
  tone = 'danger',
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
  onConfirm: () => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <dialog
      className="modal modal-open z-[90]"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
    >
      <div ref={dialogRef} className="modal-box max-w-md p-5">
        <div className="flex items-start gap-3">
          <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${tone === 'danger' ? 'bg-error/15 text-error' : 'bg-primary/15 text-primary'}`}>
            <FiAlertTriangle aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-base font-bold">{title}</h2>
            {description && <p id={descriptionId} className="mt-1.5 text-sm leading-relaxed text-base-content/60">{description}</p>}
          </div>
          <button type="button" className="text-base-content/60 hover:text-primary" onClick={onClose} aria-label="Fermer"><FiX size={18} /></button>
        </div>
        <div className="modal-action mt-5 gap-2">
          <button ref={cancelRef} type="button" className="btn btn-sm" onClick={onClose}>{cancelLabel}</button>
          <button type="button" className={`btn btn-sm ${tone === 'danger' ? 'btn-error btn-outline' : 'btn-primary'}`} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
      <div
        className="modal-backdrop"
        onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
      />
    </dialog>
  );
}
