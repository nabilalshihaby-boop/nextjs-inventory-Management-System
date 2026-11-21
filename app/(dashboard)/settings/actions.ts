"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { isCountryCode } from "@/lib/countries";
import { canManageSystemSettings } from "@/lib/roles";
import { deleteImage, saveImage, validateImage, type ValidImage } from "@/lib/image-upload";
import { DATE_FORMATS, SETTINGS_ID, toSettingsValues, type SettingsValues } from "@/lib/settings";

export type SettingsField = keyof SettingsValues | "logo";

export type SettingsState =
  | { status: "idle" }
  | { status: "error"; message: string; fieldErrors: Partial<Record<SettingsField, string>> }
  | { status: "success"; message: string; values: SettingsValues };

const optional = (max: number, label: string) =>
  z.string().trim().max(max, `${label} is too long`);

const schema = z.object({
  // A Currency record id; checked against the database below.
  defaultCurrencyId: z.string().trim().max(64),
  // Optional POS Walk-in Customer: "" clears it, otherwise a real Customer id (checked below).
  posWalkInCustomerId: z.string().trim().max(64),
  defaultEmail: z
    .string()
    .trim()
    .toLowerCase()
    .max(191, "Email is too long")
    .refine((v) => v === "" || z.email().safeParse(v).success, "Enter a valid email"),
  currencyIconRight: z.boolean(),
  companyName: z.string().trim().min(1, "Company name is required").max(120, "Company name is too long"),
  companyPhone: optional(32, "Phone").refine((v) => v === "" || /^[0-9+()\-.\s]{6,32}$/.test(v), "Enter a valid phone number"),
  developedBy: optional(120, "Developer name"),
  footerText: optional(255, "Footer"),
  country: z.string().refine(isCountryCode, "Choose a country"),
  state: z.string().trim().min(1, "State is required").max(120, "State is too long"),
  city: optional(120, "City"),
  postalCode: optional(20, "Postal code"),
  dateFormat: z.string().refine((v) => (DATE_FORMATS as readonly string[]).includes(v), "Choose a date format"),
  address: optional(500, "Address"),
  showVersionInFooter: z.boolean(),
});

const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v : "");
const nullIfEmpty = (v: string) => (v === "" ? null : v);

export async function saveSettings(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  // Global settings: OWNER only. Re-checked here before reading the form or touching the
  // database/files — page gating is not a security boundary (actions are plain POST endpoints).
  const session = await auth();
  if (!session?.user?.id) return { status: "error", message: "Your session has expired. Please sign in again.", fieldErrors: {} };
  if (!canManageSystemSettings(session.user.role)) return { status: "error", message: "Only the owner can change system settings.", fieldErrors: {} };

  const parsed = schema.safeParse({
    defaultCurrencyId: str(formData.get("defaultCurrencyId")),
    posWalkInCustomerId: str(formData.get("posWalkInCustomerId")),
    defaultEmail: str(formData.get("defaultEmail")),
    currencyIconRight: formData.get("currencyIconRight") === "on",
    companyName: str(formData.get("companyName")),
    companyPhone: str(formData.get("companyPhone")),
    developedBy: str(formData.get("developedBy")),
    footerText: str(formData.get("footerText")),
    country: str(formData.get("country")),
    state: str(formData.get("state")),
    city: str(formData.get("city")),
    postalCode: str(formData.get("postalCode")),
    dateFormat: str(formData.get("dateFormat")),
    // Browsers submit textarea line breaks as CRLF; store plain LF.
    address: str(formData.get("address")).replace(/\r\n?/g, "\n"),
    showVersionInFooter: formData.get("showVersionInFooter") === "on",
  });
  const fieldErrors: Partial<Record<SettingsField, string>> = {};
  if (!parsed.success) {
    for (const issue of parsed.error.issues) fieldErrors[issue.path[0] as SettingsField] ??= issue.message;
  }

  // Default currency must be a real Currency record (never a free-text code or symbol).
  if (parsed.success) {
    const chosen = parsed.data.defaultCurrencyId;
    const found = chosen ? await db.currency.findUnique({ where: { id: chosen }, select: { id: true } }) : null;
    if (!found) {
      const anyCurrency = await db.currency.count();
      fieldErrors.defaultCurrencyId = anyCurrency
        ? "Choose a default currency"
        : "Create a currency first, then choose it as the default currency";
    }
  }

  // The Walk-in Customer must be an existing customer (never free text or a made-up id).
  if (parsed.success && parsed.data.posWalkInCustomerId) {
    const c = await db.customer.findUnique({ where: { id: parsed.data.posWalkInCustomerId }, select: { id: true } });
    if (!c) fieldErrors.posWalkInCustomerId = "Choose an existing customer";
  }

  // Logo: an uploaded file only (never a URL), validated by content.
  const removeLogo = formData.get("removeLogo") === "on";
  const file = formData.get("logo");
  let logo: ValidImage | null = null;
  if (file instanceof File && file.size > 0 && !removeLogo) {
    const result = await validateImage(file);
    if ("error" in result) fieldErrors.logo = result.error;
    else logo = result;
  }

  if (!parsed.success || Object.keys(fieldErrors).length) {
    const first = Object.values(fieldErrors)[0] ?? "Please check the form";
    return { status: "error", message: first, fieldErrors };
  }

  const current = await db.systemSettings.findUnique({ where: { id: SETTINGS_ID }, select: { companyLogo: true } });
  const newLogo = logo ? await saveImage("logos", logo) : removeLogo ? null : undefined; // undefined = keep

  const d = parsed.data;
  const data = {
    defaultCurrencyId: d.defaultCurrencyId,
    posWalkInCustomerId: nullIfEmpty(d.posWalkInCustomerId),
    defaultEmail: nullIfEmpty(d.defaultEmail),
    currencyIconRight: d.currencyIconRight,
    companyName: d.companyName,
    companyPhone: nullIfEmpty(d.companyPhone),
    developedBy: nullIfEmpty(d.developedBy),
    footerText: nullIfEmpty(d.footerText),
    country: d.country,
    state: d.state,
    city: nullIfEmpty(d.city),
    postalCode: nullIfEmpty(d.postalCode),
    dateFormat: d.dateFormat,
    address: nullIfEmpty(d.address),
    showVersionInFooter: d.showVersionInFooter,
    ...(newLogo !== undefined ? { companyLogo: newLogo } : {}),
  };

  let saved;
  try {
    saved = await db.systemSettings.upsert({
      where: { id: SETTINGS_ID },
      create: { id: SETTINGS_ID, ...data },
      update: data,
    });
  } catch (error) {
    if (newLogo) await deleteImage("logos", newLogo);
    throw error;
  }
  if (newLogo !== undefined && current?.companyLogo !== newLogo) await deleteImage("logos", current?.companyLogo);

  // The Sign In page (/) shows the global company name and footer: refresh it too.
  revalidatePath("/");
  revalidatePath("/pos");

  return { status: "success", message: "Settings saved", values: toSettingsValues(saved) };
}
