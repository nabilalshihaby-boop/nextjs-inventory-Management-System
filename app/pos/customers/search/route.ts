import { auth } from "@/auth";
import { customerSearchSchema } from "@/lib/pos-customer-search";
import { searchCustomers } from "@/lib/pos-customer-search-data";
import { canUsePos } from "@/lib/roles";

// POS customer search. A Route Handler, not a Server Action: it only reads, and the screen can cancel a request that is out of date.
// POST keeps names, phone numbers and emails out of URLs and access logs. proxy.ts applies the /pos route rule on top of this check.
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return reply({ error: "unauthorized" }, 401);
  if (!canUsePos(session.user)) return reply({ error: "forbidden" }, 403);
  if (!request.headers.get("content-type")?.startsWith("application/json")) return reply({ error: "bad request" }, 415);

  const text = await request.text();
  let body: unknown;
  try {
    body = text.length <= 1000 ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  const parsed = customerSearchSchema.safeParse(body);
  if (!parsed.success) return reply({ error: "bad request" }, 400);
  return reply(await searchCustomers(parsed.data.q));
}
