"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import Icon from "@/components/layout/Icon";

/**
 * "Clear Cache" section (design card) + confirmation dialog (design Modal: .sp-overlay / .sp-modal).
 * Clears only this origin's temporary browser storage — localStorage, sessionStorage and Cache
 * Storage. It never touches cookies (the Auth.js session stays), MySQL data (settings, saved
 * personal theme) or uploaded files. Used on /settings and /preferences.
 */
export default function ClearCacheSection() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <h2 className="t-section-title" style={{ margin: "32px 0 16px" }}>
        Clear Cache
      </h2>
      <div className="sp-card" style={{ padding: 24, display: "flex", alignItems: "center", gap: 16 }}>
        <button type="button" className="sp-btn sp-btn--secondary" onClick={() => setOpen(true)}>
          <Icon name="eraser" size={18} />
          Clear Cache
        </button>
        <span className="t-caption">Removes stored application data and reloads the latest settings.</span>
      </div>
      {open && <ClearCacheDialog onClose={() => setOpen(false)} onCleared={() => router.refresh()} />}
    </>
  );
}

function ClearCacheDialog({ onClose, onCleared }: { onClose: () => void; onCleared: () => void }) {
  const [busy, setBusy] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (ev: KeyboardEvent) => ev.key === "Escape" && !busy && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  async function clear() {
    setBusy(true);
    try {
      try {
        window.localStorage.clear();
      } catch {}
      try {
        window.sessionStorage.clear();
      } catch {}
      if ("caches" in window) {
        const keys = await window.caches.keys();
        await Promise.all(keys.map((k) => window.caches.delete(k)));
      }
      onClose();
      onCleared();
      toast.success("Cache cleared", { id: "clear-cache" });
    } catch {
      setBusy(false);
      toast.error("Could not clear the cache", { id: "clear-cache" });
    }
  }

  return (
    <div className="sp-overlay" onMouseDown={(ev) => ev.target === ev.currentTarget && !busy && onClose()}>
      <div className="sp-modal sp-modal--sm" role="dialog" aria-modal="true" aria-labelledby="clear-cache-title">
        <div className="sp-modal-head">
          <div className="t-section-title" id="clear-cache-title">
            Clear Cache
          </div>
          <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm sp-btn--icon" aria-label="Close" onClick={onClose} disabled={busy}>
            <Icon name="x" size={16} />
          </button>
        </div>
        <div className="sp-modal-body">
          <p className="t-body" style={{ margin: 0 }}>
            This removes temporary data stored by this app in your browser and reloads the latest settings. You
            stay signed in, and saved settings, your saved appearance and uploaded files are not affected.
          </p>
        </div>
        <div className="sp-modal-foot">
          <button type="button" className="sp-btn sp-btn--secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button ref={confirmRef} type="button" className="sp-btn sp-btn--danger" onClick={clear} disabled={busy}>
            {busy ? "Clearing…" : "Clear Cache"}
          </button>
        </div>
      </div>
    </div>
  );
}
