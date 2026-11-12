import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

export function PortalBrand({ workspace = false }: { workspace?: boolean }) {
  return (
    <div className="pbs-brand">
      <img src="/pbs-logo.svg" alt="" width={42} height={42} />
      <span>
        <strong>Pragmatic BIM Solution</strong>
        <small>{workspace ? 'Student workspace' : 'BIM learning portal'}</small>
      </span>
    </div>
  );
}

export function PortalDialog({ title, onClose, children, className = '' }: {
  title: string;
  onClose: () => void;
  children?: ReactNode;
  className?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement;
    dialog?.showModal();
    dialog?.querySelector<HTMLElement>('[data-dialog-focus]')?.focus();
    return () => {
      dialog?.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus();
      }
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className={`pbs-dialog ${className}`}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="pbs-dialog-inner">
        <header className="pbs-dialog-header">
          <h2 id={titleId}>{title}</h2>
          <button className="pbs-icon-button" type="button" aria-label="Close dialog" onClick={onClose}>
            <X />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}
