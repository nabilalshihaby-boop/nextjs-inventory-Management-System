"use client";

import { useEffect, type ReactNode } from "react";
import Icon from "@/components/layout/Icon";

// Design Modal (.sp-overlay / .sp-modal): title bar with close button, body, optional footer.
// Escape and a click on the backdrop close it.
export default function Modal({
  title,
  onClose,
  footer,
  size = "sm",
  children,
}: {
  title: string;
  onClose: () => void;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="sp-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`sp-modal sp-modal--${size}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="sp-modal-head">
          <div className="t-section-title">{title}</div>
          <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm sp-btn--icon" aria-label="Close" onClick={onClose}>
            <Icon name="x" size={16} />
          </button>
        </div>
        <div className="sp-modal-body">{children}</div>
        {footer && <div className="sp-modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/** Design ConfirmDeleteModal: warning icon + "Are you sure…" text, Cancel / Delete. */
export function ConfirmDeleteModal({
  itemType,
  itemName,
  busy,
  onCancel,
  onConfirm,
}: {
  itemType: string;
  itemName?: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      title={itemName ? `Delete ${itemName}?` : `Delete ${itemType}?`}
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="sp-btn sp-btn--secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="sp-btn sp-btn--danger" onClick={onConfirm} disabled={busy}>
            <Icon name="trash-2" size={18} />
            Delete
          </button>
        </>
      }
    >
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        <span
          style={{
            flex: "none",
            width: 44,
            height: 44,
            borderRadius: "50%",
            background: "var(--danger-50)",
            color: "var(--danger-700)",
            display: "grid",
            placeItems: "center",
            boxShadow: "inset 0 0 0 1px var(--danger-100)",
          }}
        >
          <Icon name="triangle-alert" size={22} />
        </span>
        <p className="t-body" style={{ margin: 0, color: "var(--text-2)" }}>
          Are you sure you want to delete this {itemType}? This action cannot be undone.
        </p>
      </div>
    </Modal>
  );
}
