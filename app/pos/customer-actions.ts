"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { recordAudit } from "@/lib/audit";
import { insertCustomer } from "@/lib/customer-create";
import { makeQuickCustomerSchema, type QuickCustomerField } from "@/lib/customers";
import { getDict } from "@/lib/i18n/server";
import { canCreateCustomers, canUsePos } from "@/lib/roles";

// POS quick add: creates a customer and nothing else (no sale, payment, stock, ledger, cash/bank or held-order write).

export type QuickCustomerResult =
  | { ok: true; message: string; customer: { id: string; name: string } }
  | { ok: false; message: string; fieldErrors?: Partial<Record<QuickCustomerField, string>> };

export async function createPosCustomer(input: unknown): Promise<QuickCustomerResult> {
  const session = await auth();
  const t = await getDict();
  if (!session?.user?.id) return { ok: false, message: t.common.sessionExpired };
  if (!canUsePos(session.user)) return { ok: false, message: t.pos.noPermission };
  if (!canCreateCustomers(session.user)) return { ok: false, message: t.posTx.quickCustomer.noPermission };

  const parsed = makeQuickCustomerSchema(t.customers.val).safeParse(input);
  if (!parsed.success) {
    if (parsed.error.issues.some((i) => i.code === "unrecognized_keys")) return { ok: false, message: t.common.unexpectedFields };
    if (parsed.error.issues.some((i) => i.code === "invalid_type")) return { ok: false, message: t.common.checkForm };
    const fieldErrors: Partial<Record<QuickCustomerField, string>> = {};
    for (const issue of parsed.error.issues) fieldErrors[issue.path[0] as QuickCustomerField] ??= issue.message;
    return { ok: false, message: Object.values(fieldErrors)[0] ?? t.common.checkForm, fieldErrors };
  }

  // Everything but the name is optional: what wasn't given is stored empty (the columns are NOT NULL).
  const { name, email = "", phoneNumber = "" } = parsed.data;
  const actorId = session.user.id;
  const r = await insertCustomer({ name, email, phoneNumber, countryCode: "", city: "", address: "" }, (tx, c) =>
    recordAudit(tx, { actorId, eventType: "CUSTOMER_CREATED", targetType: "CUSTOMER", targetId: c.id, metadata: { name: c.name, source: "POS" } }),
  );
  if (!r.ok) return { ok: false, message: t.customers.duplicate, fieldErrors: { name: t.customers.duplicate } };
  revalidatePath("/customers");
  revalidatePath("/customer-payments");
  return { ok: true, message: t.customers.ok.created, customer: r.customer };
}
