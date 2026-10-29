import { useEffect, useRef } from "react";
import { X } from "lucide-react";
export function Panel({
  title,
  onClose,
  children,
  wide = false,
  variant,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
  variant?: "event" | "quick-event";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current!;
    d.showModal();
    d.querySelector<HTMLElement>(
      'input:not(:disabled):not([type="hidden"]), textarea:not(:disabled), select:not(:disabled)',
    )?.focus();
    return () => d.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`panel ${wide ? "palette" : ""} ${variant ? `${variant}-panel` : ""}`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="panel-inner">
        <header>
          <h2>{title}</h2>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Close panel"
          >
            <X size={20} />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}
