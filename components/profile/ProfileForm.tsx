"use client";

import { startTransition, useActionState, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Icon from "@/components/layout/Icon";
import { useT } from "@/components/i18n/I18nProvider";
import {
  updateProfile,
  type ProfileFieldErrors,
  type ProfileState,
  type ProfileValues,
} from "@/app/(dashboard)/profile/actions";

type TextField = "firstName" | "lastName" | "email" | "phoneNumber";

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const ACCEPT = ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp";

// Markup follows design/Create User.html (PageHeader + FormCard + Field/Input + avatar picker),
// adapted to edit the signed-in user. No password fields: Change Password is a separate page.
export default function ProfileForm({ initial, roleLabel }: { initial: ProfileValues; roleLabel: string }) {
  const t = useT();
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ProfileState, FormData>(updateProfile, { status: "idle" });

  const [saved, setSaved] = useState(initial); // last saved values (drives the avatar + "remove" option)
  const [f, setF] = useState<Record<TextField, string>>({
    firstName: initial.firstName,
    lastName: initial.lastName,
    email: initial.email,
    phoneNumber: initial.phoneNumber,
  });
  const [e, setE] = useState<ProfileFieldErrors>({});
  const [notice, setNotice] = useState<{ kind: "success" | "danger"; text: string } | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Apply each new action result once (adjusting state during render, not in an effect).
  const [handled, setHandled] = useState(state);
  if (state !== handled) {
    setHandled(state);
    if (state.status === "success") {
      const { firstName, lastName, email, phoneNumber } = state.values;
      setSaved(state.values);
      setF({ firstName, lastName, email, phoneNumber });
      setE({});
      setRemoveAvatar(false);
      setPreview(null);
      setImageFailed(false);
      setNotice({ kind: "success", text: state.message });
    } else if (state.status === "error") {
      setE(state.fieldErrors);
      setNotice({ kind: "danger", text: state.message });
    }
  }

  // After a successful save: clear the chosen file (file inputs can't be controlled) and refetch
  // the route so the shared topbar re-renders from the refreshed session cookie.
  useEffect(() => {
    if (state.status !== "success") return;
    if (fileRef.current) fileRef.current.value = "";
    router.refresh();
  }, [state, router]);

  // Release object URLs for previews.
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  const set = (k: TextField) => (ev: ChangeEvent<HTMLInputElement>) => {
    setF({ ...f, [k]: ev.target.value });
    setE({ ...e, [k]: "" });
    setNotice(null);
  };

  function onFile(ev: ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0];
    setNotice(null);
    setE({ ...e, avatar: "" });
    if (!file) return setPreview(null);
    // Quick client-side check for a better message; the server action re-validates everything.
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!["jpg", "jpeg", "png", "webp"].includes(ext)) {
      ev.target.value = "";
      setPreview(null);
      return setE({ ...e, avatar: t.profile.avatarType });
    }
    if (file.size > MAX_AVATAR_BYTES) {
      ev.target.value = "";
      setPreview(null);
      return setE({ ...e, avatar: t.profile.avatarSize });
    }
    setRemoveAvatar(false);
    setImageFailed(false);
    setPreview(URL.createObjectURL(file));
  }

  function onRemove(ev: ChangeEvent<HTMLInputElement>) {
    setRemoveAvatar(ev.target.checked);
    setNotice(null);
    if (ev.target.checked) {
      if (fileRef.current) fileRef.current.value = "";
      setPreview(null);
      setE({ ...e, avatar: "" });
    }
  }

  function submit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const n: ProfileFieldErrors = {};
    if (!f.firstName.trim()) n.firstName = t.profile.firstRequired;
    if (!f.lastName.trim()) n.lastName = t.profile.lastRequired;
    if (!/^\S+@\S+\.\S+$/.test(f.email.trim())) n.email = t.profile.emailInvalid;
    if (!f.phoneNumber.trim()) n.phoneNumber = t.profile.phoneRequired;
    if (Object.keys(n).length) {
      setE(n);
      setNotice(null);
      return;
    }
    const data = new FormData(ev.currentTarget);
    startTransition(() => formAction(data));
  }

  const ok = (["firstName", "lastName", "email", "phoneNumber"] as const).every((k) => f[k].trim());
  const shownImage = removeAvatar ? null : (preview ?? (imageFailed ? null : saved.image));

  const field = (k: TextField, label: string, placeholder: string, type = "text", autoComplete?: string) => (
    <div className={"sp-field" + (e[k] ? " sp-field--error" : "")}>
      <label className="sp-label" htmlFor={`pf-${k}`}>
        {label}
        <i>*</i>
      </label>
      <input
        id={`pf-${k}`}
        name={k}
        type={type}
        className="sp-input "
        placeholder={placeholder}
        autoComplete={autoComplete}
        value={f[k]}
        onChange={set(k)}
        aria-invalid={!!e[k] || undefined}
        aria-describedby={e[k] ? `pf-${k}-error` : undefined}
      />
      {e[k] && (
        <span className="sp-error" id={`pf-${k}-error`}>
          {e[k]}
        </span>
      )}
    </div>
  );

  return (
    // method="post": if submitted before hydration, fields go in the body, never the URL.
    <form method="post" encType="multipart/form-data" onSubmit={submit} noValidate aria-busy={pending}>
      <div className="sp-card sp-form-card">
        {notice && (
          <div
            className={`sp-badge sp-badge--${notice.kind}`}
            role={notice.kind === "danger" ? "alert" : "status"}
            style={{ height: "auto", padding: "10px 14px", whiteSpace: "normal", marginBottom: 24 }}
          >
            <Icon name={notice.kind === "danger" ? "circle-alert" : "info"} size={16} />
            {notice.text}
          </div>
        )}
        <div className="sp-form-grid" style={{ "--cols": 2 } as React.CSSProperties}>
          <div className={"sp-field sp-span-all" + (e.avatar ? " sp-field--error" : "")}>
            <label className="sp-label" htmlFor="pf-avatar">
              {t.profile.changeImage}
            </label>
            <div style={{ position: "relative", width: 100 }}>
              <span
                className="sp-avatar"
                style={{
                  width: 100,
                  height: 100,
                  fontSize: 30,
                  overflow: "hidden",
                  background: shownImage ? "transparent" : undefined,
                }}
              >
                {shownImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={shownImage}
                    alt=""
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    onError={() => !preview && setImageFailed(true)}
                  />
                ) : (
                  <Icon name="user" size={44} />
                )}
              </span>
              <button
                type="button"
                className="sp-btn sp-btn--secondary sp-btn--sm sp-btn--icon"
                aria-label={t.profile.changeImage}
                style={{ position: "absolute", top: -6, right: -6, borderRadius: "50%" }}
                onClick={() => fileRef.current?.click()}
              >
                <Icon name="pencil" size={16} />
              </button>
              <input ref={fileRef} id="pf-avatar" name="avatar" type="file" accept={ACCEPT} hidden onChange={onFile} />
            </div>
            {e.avatar ? (
              <span className="sp-error">{e.avatar}</span>
            ) : (
              <span className="sp-hint">{t.profile.imageHint}</span>
            )}
            {saved.image && (
              <label className="sp-check" style={{ marginTop: 4 }}>
                <input type="checkbox" name="removeAvatar" checked={removeAvatar} onChange={onRemove} />
                {t.profile.removeAvatar}
              </label>
            )}
          </div>

          {field("firstName", t.profile.firstName, t.profile.firstNamePh, "text", "given-name")}
          {field("lastName", t.profile.lastName, t.profile.lastNamePh, "text", "family-name")}
          {field("email", t.profile.email, t.profile.emailPh, "email", "email")}
          {field("phoneNumber", t.profile.phone, t.profile.phonePh, "tel", "tel")}

          <div className="sp-field">
            <label className="sp-label" htmlFor="pf-role">
              {t.profile.role}
            </label>
            {/* Read-only: self-profile updates must never modify role. The select is disabled and
                unnamed, so it is not submitted; the server action ignores any role value anyway. */}
            <select id="pf-role" className="sp-select" value={roleLabel} disabled aria-readonly="true">
              <option value={roleLabel}>{roleLabel}</option>
            </select>
          </div>
        </div>
        <div className="sp-form-actions">
          <button type="button" className="sp-btn sp-btn--secondary" onClick={() => router.push("/dashboard")}>
            {t.common.cancel}
          </button>
          <button type="submit" className="sp-btn sp-btn--primary" disabled={!ok || pending}>
            {pending ? t.common.saving : t.common.save}
          </button>
        </div>
      </div>
    </form>
  );
}
