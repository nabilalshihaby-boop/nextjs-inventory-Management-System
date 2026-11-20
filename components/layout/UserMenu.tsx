"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { signOut } from "next-auth/react";
import Icon from "./Icon";

export type TopbarUser = {
  name: string;
  roleLabel: string;
  image: string | null;
};

// Topbar user block + dropdown. Uses the design's .sp-user / .sp-menu pattern (same as RowMenu).
export default function UserMenu({ user }: { user: TopbarUser }) {
  const [open, setOpen] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const close = () => setOpen(false);
  const showImage = !!user.image && !imageFailed;
  const initial = user.name.trim().charAt(0).toUpperCase();

  async function logout() {
    close();
    setSigningOut(true);
    await signOut({ redirectTo: "/" });
  }

  return (
    <div className="sp-user" ref={ref}>
      <button
        ref={buttonRef}
        type="button"
        className="sp-user-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="bp-user-menu"
        onClick={() => setOpen(!open)}
      >
        <span className="sp-avatar" style={showImage ? { overflow: "hidden" } : undefined}>
          {showImage ? (
            // Plain <img>: avatar URLs can be on any host, and next/image would need remotePatterns.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.image!}
              alt=""
              width={34}
              height={34}
              referrerPolicy="no-referrer"
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
              onError={() => setImageFailed(true)}
            />
          ) : (
            initial
          )}
        </span>
        <span>
          {user.name}
          <small>{user.roleLabel}</small>
        </span>
        <Icon name="chevron-down" size={16} />
      </button>
      {open && (
        <div className="sp-menu" id="bp-user-menu" role="menu">
          <Link href="/profile" className="sp-menu-item" role="menuitem" style={{ textDecoration: "none" }} onClick={close}>
            <Icon name="user" size={16} />
            Profile
          </Link>
          <Link
            href="/change-password"
            className="sp-menu-item"
            role="menuitem"
            style={{ textDecoration: "none" }}
            onClick={close}
          >
            <Icon name="key-round" size={16} />
            Change Password
          </Link>
          <div className="sp-menu-sep" role="separator" />
          <button
            type="button"
            className="sp-menu-item sp-menu-item--danger"
            role="menuitem"
            disabled={signingOut}
            onClick={logout}
          >
            <Icon name="log-out" size={16} />
            Logout
          </button>
        </div>
      )}
    </div>
  );
}
