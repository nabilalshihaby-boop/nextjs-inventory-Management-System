// Server-only: the limited customer lookup behind the POS selector. Read-only; the caller authorizes first.
// A customer has no code/reference column, so name, phone and email are what can be searched.
import { Prisma } from "@/app/generated/prisma/client";
import { db } from "@/lib/db";
import { getSystemSettings } from "@/lib/settings";
import { contactHint, CUSTOMER_SEARCH_LIMIT, IGNORED_MARKS, LETTER_FOLDS, normalizeSearch, type CustomerSearchResponse } from "@/lib/pos-customer-search";

const like = (v: string) => v.replace(/[\\%_]/g, "\\$&");
/** The stored name, folded the same way as normalizeSearch() folds the query. */
const foldedName = LETTER_FOLDS.reduce((sql, [from, to]) => Prisma.sql`REPLACE(${sql}, ${from}, ${to})`, Prisma.sql`REGEXP_REPLACE(LOWER(name), ${`[${IGNORED_MARKS}]`}, '')`);

export async function searchCustomers(query: string): Promise<CustomerSearchResponse> {
  const q = normalizeSearch(query);
  // The configured Walk-in Customer is pinned by the screen, so it is not repeated in the results.
  const walkInId = (await getSystemSettings())?.posWalkInCustomerId ?? "";

  const matches: Prisma.Sql[] = [];
  if (q) {
    matches.push(Prisma.sql`(${Prisma.join(q.split(" ").map((word) => Prisma.sql`${foldedName} LIKE ${`%${like(word)}%`}`), " AND ")})`);
    if (!q.includes(" ")) matches.push(Prisma.sql`LOWER(email) LIKE ${`%${like(q)}%`}`);
    const digits = q.replace(/\D/g, "");
    if (digits.length >= 3 && /^[0-9+()\-.\s]+$/.test(q)) matches.push(Prisma.sql`REGEXP_REPLACE(phoneNumber, '[^0-9]', '') LIKE ${`%${digits}%`}`);
  }
  const where = matches.length ? Prisma.sql`AND (${Prisma.join(matches, " OR ")})` : Prisma.empty;
  const order = q ? Prisma.sql`(${foldedName} LIKE ${`${like(q)}%`}) DESC, name ASC` : Prisma.sql`name ASC`;

  const rows = await db.$queryRaw<{ id: string; name: string; phoneNumber: string; email: string }[]>`
    SELECT id, name, phoneNumber, email FROM customers WHERE id <> ${walkInId} ${where} ORDER BY ${order} LIMIT ${CUSTOMER_SEARCH_LIMIT + 1}`;
  return {
    customers: rows.slice(0, CUSTOMER_SEARCH_LIMIT).map((c) => ({ id: c.id, name: c.name, hint: contactHint(c.phoneNumber, c.email) })),
    more: rows.length > CUSTOMER_SEARCH_LIMIT,
  };
}
