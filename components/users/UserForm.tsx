"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition, type ChangeEvent, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import Icon from "@/components/layout/Icon";
import { useT } from "@/components/i18n/I18nProvider";
import { fmt } from "@/lib/i18n/config";
import { createUser, updateUser, type UserResult } from "@/app/(dashboard)/users/actions";
import { ASSIGNABLE_ROLES, MIN_PASSWORD, type UserField, type UserFormValues } from "@/lib/users";

// Port of design/Create User.html: PageHeader (+ Back), FormCard (2 columns, Cancel / Save):
// Change Image (avatar picker), First Name, Last Name, Email, Phone Number, Password, Confirm
// Password, Role. Roles offered: Administrator and User only (never Owner). Password fields always
// start empty; on edit they're optional (empty = keep the current password).

const MAX_BYTES = 2 * 1024 * 1024;
const ACCEPT = ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp";
const EMPTY: UserFormValues = { firstName: "", lastName: "", email: "", phoneNumber: "", role: "", image: null };
type Text = "firstName" | "lastName" | "email" | "phoneNumber" | "password" | "confirmPassword";

export default function UserForm({ userId, initial }: { userId?: string; initial?: UserFormValues }) {
  const router = useRouter();
  const T = useT();
  const F = T.users.form;
  const V = T.users.val;
  const editing = !!userId;
  const start = initial ?? EMPTY;
  const [f, setF] = useState<Record<Text | "role", string>>({ firstName: start.firstName, lastName: start.lastName, email: start.email, phoneNumber: start.phoneNumber, role: start.role, password: "", confirmPassword: "" });
  const [e, setE] = useState<Partial<Record<UserField, string>>>({});
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  const set = (k: Text | "role") => (ev: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setF({ ...f, [k]: ev.target.value });
    setE({ ...e, [k]: "" });
  };
  const ok = (["firstName", "lastName", "email", "phoneNumber", "role"] as const).every((k) => f[k].trim()) && (editing || (f.password && f.confirmPassword));

  function onFile(ev: ChangeEvent<HTMLInputElement>) {
    const x = ev.target.files?.[0];
    ev.target.value = "";
    if (!x) return;
    // Quick client-side check for a better message; the server validates the actual content.
    const ext = x.name.split(".").pop()?.toLowerCase() ?? "";
    const problem = !["jpg", "jpeg", "png", "webp"].includes(ext) ? T.profile.avatarType : x.size > MAX_BYTES ? T.profile.avatarSize : null;
    if (problem) {
      setE({ ...e, avatar: problem });
      toast.error(problem, { id: "user" });
      return;
    }
    setE({ ...e, avatar: "" });
    setFile(x);
    setRemoveAvatar(false);
    setPreview(URL.createObjectURL(x));
  }

  function save() {
    const n: Partial<Record<UserField, string>> = {};
    if (!f.firstName.trim()) n.firstName = V.firstRequired;
    if (!f.lastName.trim()) n.lastName = V.lastRequired;
    if (!/^\S+@\S+\.\S+$/.test(f.email.trim())) n.email = V.emailInvalid;
    if (!f.phoneNumber.trim()) n.phoneNumber = V.phoneRequired;
    if (!editing || f.password || f.confirmPassword) {
      if (f.password.length < MIN_PASSWORD) n.password = fmt(V.passwordMin, { min: MIN_PASSWORD });
      else if (f.password !== f.confirmPassword) n.confirmPassword = V.mismatch;
    }
    if (!f.role) n.role = V.roleRequired;
    setE(n);
    if (Object.keys(n).length) {
      toast.error(Object.values(n)[0]!, { id: "user" });
      return;
    }
    const fd = new FormData();
    for (const [k, v] of Object.entries(f)) fd.set(k, v);
    if (file) fd.set("avatar", file);
    if (removeAvatar) fd.set("removeAvatar", "on");
    startTransition(async () => {
      let r: UserResult;
      try {
        r = editing ? await updateUser(userId, fd) : await createUser(fd);
      } catch {
        toast.error(T.common.somethingWrong, { id: "user" });
        return;
      }
      if (!r.ok) {
        if (r.fieldErrors) setE(r.fieldErrors);
        toast.error(r.message, { id: "user" });
        return;
      }
      setF((x) => ({ ...x, password: "", confirmPassword: "" })); // never keep passwords around
      toast.success(r.message, { id: "user" });
      router.push("/users");
      router.refresh();
    });
  }

  const shown = removeAvatar ? null : (preview ?? start.image);
  const field = (k: Text, label: string, placeholder: string, type = "text", required = true, autoComplete?: string) => (
    <div className={"sp-field" + (e[k] ? " sp-field--error" : "")}>
      <label className="sp-label" htmlFor={`us-${k}`}>
        {label}
        {required && <i>*</i>}
      </label>
      <input id={`us-${k}`} name={k} type={type} className="sp-input " dir={type === "email" || type === "tel" || type === "password" ? "ltr" : undefined} placeholder={placeholder} value={f[k]} onChange={set(k)} autoComplete={autoComplete} aria-invalid={!!e[k] || undefined} />
      {e[k] && <span className="sp-error" id={`us-${k}-error`}>{e[k]}</span>}
    </div>
  );

  return (
    <>
      <div className="sp-page-head">
        <h1 className="t-page-title" style={{ margin: 0 }}>
          {editing ? T.users.editTitle : T.users.createTitle}
        </h1>
        <div style={{ display: "flex", gap: 12 }}>
          <Link href="/users" className="sp-btn sp-btn--secondary">
            <Icon name="arrow-left" size={18} />
            {F.back}
          </Link>
        </div>
      </div>
      <form
        method="post"
        encType="multipart/form-data"
        noValidate
        aria-busy={pending}
        onSubmit={(ev) => {
          ev.preventDefault();
          save();
        }}
      >
        <div className="sp-card sp-form-card">
          <div className="sp-form-grid" style={{ "--cols": 2 } as CSSProperties}>
            <div className={"sp-field sp-span-all" + (e.avatar ? " sp-field--error" : "")}>
              <label className="sp-label" htmlFor="us-avatar">
                {F.changeImage}
              </label>
              <div style={{ position: "relative", width: 100 }}>
                <span className="sp-avatar" style={{ width: 100, height: 100, fontSize: 30, overflow: "hidden", background: shown ? "transparent" : undefined }} data-testid="avatar-preview">
                  {shown ? (
                    // eslint-disable-next-line @next/next/no-img-element -- blob preview / runtime upload
                    <img src={shown} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    <Icon name="user" size={44} />
                  )}
                </span>
                <button type="button" className="sp-btn sp-btn--secondary sp-btn--sm sp-btn--icon" aria-label={F.changeImageAria} style={{ position: "absolute", top: -6, insetInlineEnd: -6, borderRadius: "50%" }} onClick={() => fileRef.current?.click()}>
                  <Icon name="pencil" size={16} />
                </button>
                <input ref={fileRef} id="us-avatar" type="file" accept={ACCEPT} hidden onChange={onFile} />
              </div>
              {e.avatar ? <span className="sp-error">{e.avatar}</span> : <span className="sp-hint">{F.imageHint}</span>}
              {(start.image || file) && (
                <label className="sp-check" style={{ marginTop: 4 }}>
                  <input
                    type="checkbox"
                    id="us-removeAvatar"
                    checked={removeAvatar}
                    onChange={(ev) => {
                      setRemoveAvatar(ev.target.checked);
                      if (ev.target.checked) {
                        setFile(null);
                        setPreview(null);
                      }
                    }}
                  />
                  {F.removeImage}
                </label>
              )}
            </div>

            {field("firstName", F.firstName, F.firstNamePh, "text", true, "off")}
            {field("lastName", F.lastName, F.lastNamePh, "text", true, "off")}
            {field("email", F.email, F.emailPh, "email", true, "off")}
            {field("phoneNumber", F.phone, F.phonePh, "tel", true, "off")}
            {field("password", F.password, editing ? F.passwordPhEdit : F.passwordPh, "password", !editing, "new-password")}
            {field("confirmPassword", F.confirm, editing ? F.confirmPhEdit : F.confirmPh, "password", !editing, "new-password")}
            <div className={"sp-field" + (e.role ? " sp-field--error" : "")}>
              <label className="sp-label" htmlFor="us-role">
                {F.role}<i>*</i>
              </label>
              <select id="us-role" name="role" className={"sp-select " + (f.role ? "" : "sp-select--placeholder")} value={f.role} onChange={set("role")} aria-invalid={!!e.role || undefined}>
                <option value="" disabled>
                  {F.rolePh}
                </option>
                {ASSIGNABLE_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {(T.roles as Record<string, string>)[r]}
                  </option>
                ))}
              </select>
              {e.role && <span className="sp-error" id="us-role-error">{e.role}</span>}
            </div>
            {editing && (
              <span className="t-caption sp-span-all" style={{ marginTop: -8 }}>
                {fmt(F.editHint, { min: MIN_PASSWORD })}
              </span>
            )}
          </div>
          <div className="sp-form-actions">
            <button type="button" className="sp-btn sp-btn--secondary" onClick={() => router.push("/users")} disabled={pending}>
              {F.cancel}
            </button>
            <button type="submit" className="sp-btn sp-btn--primary" disabled={!ok || pending}>
              {pending ? T.common.saving : F.save}
            </button>
          </div>
        </div>
      </form>
    </>
  );
}
