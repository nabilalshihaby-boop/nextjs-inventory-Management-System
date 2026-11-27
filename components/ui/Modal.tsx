"use client";

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import Icon from "@/components/layout/Icon";
import { fmt } from "@/lib/i18n/config";
import { useT } from "@/components/i18n/I18nProvider";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const focusables = (root: Element) => [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((e) => e.getClientRects().length > 0);
const stack: HTMLElement[] = []; // open modals: only the top one keeps Tab inside

/**
 * Focus management: the first control is focused on open, Tab / Shift+Tab stay inside, and focus goes back to what opened the
 * modal (or `returnFocusRef`) on close, unless the closing code has already moved it somewhere else.
 */
function useModalFocus(returnFocusRef?: RefObject<HTMLElement | null>) {
  const ref = useRef<HTMLDivElement>(null);
  // Read during the first render: by effect time an autoFocus field inside the modal already has the focus.
  const [opener] = useState(() => (typeof document === "undefined" ? null : (document.activeElement as HTMLElement | null)));
  useEffect(() => {
    const box = ref.current!;
    const back = returnFocusRef?.current; // the trigger is on the page before the modal opens
    stack.push(box);
    if (!box.contains(document.activeElement)) {
      // Body first, then footer (Cancel comes first there), then the close button.
      const target = [".sp-modal-body", ".sp-modal-foot", ".sp-modal-head"].flatMap((s) => [...box.querySelectorAll(`:scope > ${s}`)].flatMap(focusables))[0];
      (target ?? box).focus();
    }
    const onTab = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || stack[stack.length - 1] !== box) return;
      const list = focusables(box);
      const at = list.indexOf(document.activeElement as HTMLElement);
      const next = !list.length ? box : at < 0 ? list[e.shiftKey ? list.length - 1 : 0] : e.shiftKey && at === 0 ? list[list.length - 1] : !e.shiftKey && at === list.length - 1 ? list[0] : null;
      if (!next) return;
      e.preventDefault();
      next.focus();
    };
    document.addEventListener("keydown", onTab);
    return () => {
      document.removeEventListener("keydown", onTab);
      stack.splice(stack.indexOf(box), 1);
      const now = document.activeElement;
      if (now && now !== document.body && !box.contains(now)) return;
      const to = back ?? opener;
      if (to?.isConnected) to.focus();
    };
  }, [opener, returnFocusRef]);
  return ref;
}

// Design Modal (.sp-overlay / .sp-modal): title bar with close button, body, optional footer.
// Escape and a click on the backdrop close it.
export default function Modal({
  title,
  onClose,
  footer,
  size = "sm",
  returnFocusRef,
  children,
}: {
  title: string;
  onClose: () => void;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
  returnFocusRef?: RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  const t = useT();
  const ref = useModalFocus(returnFocusRef);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="sp-overlay"
      onMouseDown={(e) => {
        if (e.target !== e.currentTarget) return;
        e.preventDefault(); // or the click would move the focus to <body> after it is handed back
        onClose();
      }}
    >
      <div ref={ref} tabIndex={-1} className={`sp-modal sp-modal--${size}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="sp-modal-head">
          <div className="t-section-title">{title}</div>
          <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm sp-btn--icon" aria-label={t.common.close} onClick={onClose}>
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
  const t = useT();
  return (
    <Modal
      title={fmt(t.common.deleteTitle, { name: itemName ?? itemType })}
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="sp-btn sp-btn--secondary" onClick={onCancel} disabled={busy}>
            {t.common.cancel}
          </button>
          <button type="button" className="sp-btn sp-btn--danger" onClick={onConfirm} disabled={busy}>
            <Icon name="trash-2" size={18} />
            {t.common.delete}
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
          {fmt(t.common.deleteBody, { type: itemType })}
        </p>
      </div>
    </Modal>
  );
}
