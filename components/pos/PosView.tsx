"use client";

import Link from "next/link";
import { useMemo, useRef, useState, useTransition } from "react";
import toast from "react-hot-toast";
import { posCheckout } from "@/app/pos/actions";
import { discardHeldOrder, holdPosOrder, resumeHeldOrder } from "@/app/pos/held-actions";
import { unlockPos, unlockPosWithPin } from "@/app/pos/lock-actions";
import { closeRegister, getRegisters, openRegister, recordRegisterMovement } from "@/app/pos/register-actions";
import Icon from "@/components/layout/Icon";
import Modal, { ConfirmDeleteModal } from "@/components/ui/Modal";
import { PAYMENT_METHODS } from "@/lib/cash-bank";
import { formatMoney } from "@/lib/money";
import { calcSale } from "@/lib/sales";
import { fromUnits, toUnits } from "@/lib/transfers";
import { MAX_TENDERS, type PosData, type PosProduct } from "@/lib/pos";
import type { HeldOrderSummary } from "@/lib/pos-held";
import { MOVEMENT_LABEL, type RegisterMovementType, type RegisterOverview } from "@/lib/register";

// Port of design/POS.html (own full-screen layout, no dashboard shell): customer / warehouse
// selectors, the cart with quantity steppers, totals, Reset and Pay Now, the Scan/Search field, the
// tool buttons (Held orders, Register details, Calculator and Lock Screen from the design are NOT
// built — they need features that aren't part of this step; fullscreen and Dashboard are), category
// and brand chips, the product grid, and the Make Payment / Payment Complete modals.
// Deviations (real data / scope): no Walk-in customer (a real customer is required), no order-level
// Tax / Discount / Shipping fields, one payment method + one account (no Unpaid/Partial status, no
// split tender). Every number here is a PREVIEW — posCheckout re-reads prices, tax, stock, account
// and totals on the server and only receives ids, quantities, method, account, notes and the key.

type CartLine = { product: PosProduct; qty: number; missing?: boolean };
type Method = (typeof PAYMENT_METHODS)[number];
/** One payment row of the (possibly split) checkout. A single row always pays the full Grand Total. */
type Tender = { key: string; method: Method; account: string; amount: string };
const MONEY_RE = /^\d{1,12}(\.\d{1,2})?$/;

export default function PosView({ data, initialHeld }: { data: PosData; initialHeld: HeldOrderSummary[] }) {
  const cur = data.currency;
  const m = (v: string) => formatMoney(v, cur ?? { code: "", symbol: "", right: false });
  const walkInId = data.walkInCustomerId;
  const [customer, setCustomer] = useState(walkInId ?? ""); // the configured Walk-in Customer is pre-selected
  const isWalkIn = !!walkInId && customer === walkInId;
  const [warehouse, setWarehouse] = useState(data.warehouses.length === 1 ? data.warehouses[0].id : "");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");
  const [brand, setBrand] = useState("all");
  const [pay, setPay] = useState(false);
  const [tenders, setTenders] = useState<Tender[]>([]);
  const tenderSeq = useRef(0);
  const newTender = (amount: string, method: Method = "Cash", account = data.accounts.length === 1 ? data.accounts[0].id : ""): Tender => ({ key: `t${++tenderSeq.current}`, method, account, amount });
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState("");
  const [done, setDone] = useState<{ saleId: string; reference: string; replayed: boolean } | null>(null);
  const [pending, startTransition] = useTransition();
  const [fs, setFs] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  // Held orders (server-side drafts) and the POS-only lock screen (in-memory; the cart state below stays in this component).
  // Register sessions (cash-drawer shifts): display state; checkout and Close Register re-check on the server.
  const cashAccounts = data.accounts.filter((a) => a.type === "CASH");
  const [registers, setRegisters] = useState<RegisterOverview>(data.registers);
  const [showRegister, setShowRegister] = useState(false);
  const [regAccount, setRegAccount] = useState(() => (cashAccounts.find((a) => data.registers.open.some((r) => r.accountId === a.id)) ?? cashAccounts[0])?.id ?? "");
  const [openingCash, setOpeningCash] = useState("");
  const [openNotes, setOpenNotes] = useState("");
  const [closingCash, setClosingCash] = useState("");
  const [closeNotes, setCloseNotes] = useState("");
  // Denomination counting (only when the sale currency has active denominations; otherwise typed counted cash).
  const denoms = data.denominations;
  const [counts, setCounts] = useState<Record<string, string>>({});
  const countOf = (id: string) => (/^\d{1,7}$/.test((counts[id] ?? "0").trim() || "0") ? Number((counts[id] ?? "0").trim() || "0") : null);
  const countsValid = denoms.every((x) => countOf(x.id) !== null);
  const countedUnits = denoms.reduce((n, x) => n + toUnits(x.value, 2) * BigInt(countOf(x.id) ?? 0), BigInt(0));
  const [regErr, setRegErr] = useState("");
  // Cash In / Cash Out form (only for an OPEN register)
  const [moveType, setMoveType] = useState<RegisterMovementType | null>(null);
  const [moveAccount, setMoveAccount] = useState("");
  const [moveAmount, setMoveAmount] = useState("");
  const [moveNotes, setMoveNotes] = useState("");
  const openFor = (accountId: string) => registers.open.find((r) => r.accountId === accountId);
  const curReg = openFor(regAccount);
  const [held, setHeld] = useState(initialHeld);
  const [showHeld, setShowHeld] = useState(false);
  const [heldId, setHeldId] = useState(""); // the held order the cart was resumed from
  const [problems, setProblems] = useState<string[]>([]);
  const [discard, setDiscard] = useState<HeldOrderSummary | null>(null);
  const holdKeyRef = useRef<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [lockErr, setLockErr] = useState("");
  const [lockPw, setLockPw] = useState("");
  // With a configured PIN the lock screen asks for it first; the account password is always available.
  const [lockMode, setLockMode] = useState<"pin" | "password">(data.hasPin ? "pin" : "password");
  const [lockPin, setLockPin] = useState("");
  // One key per checkout attempt: kept across retries of the SAME open payment dialog (so a retry
  // after a slow/failed response can never repeat the sale), dropped when the dialog is cancelled.
  const keyRef = useRef<string | null>(null);

  const stockOf = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of data.stock) if (s.warehouseId === warehouse) map.set(s.productId, Number(s.quantity));
    return map;
  }, [data.stock, warehouse]);

  const needle = q.trim().toLowerCase();
  const list = data.products.filter((p) => (!needle || `${p.code} ${p.name}`.toLowerCase().includes(needle)) && (cat === "all" || p.category === cat) && (brand === "all" || p.brand === brand));

  const totals = useMemo(
    () => calcSale(cart.map((l) => ({ quantity: String(l.qty), unitPrice: l.product.price, taxType: l.product.taxType, taxRate: l.product.taxRate, discountType: "FIXED" as const, discountValue: "0.00" })), { orderTaxRate: "0.00", discount: "0.00", shipping: "0.00" }),
    [cart],
  );
  const qtyTotal = cart.reduce((a, l) => a + l.qty, 0);
  const grandOk = cart.length > 0 && !totals.error && toUnits(totals.grandTotal, 2) > BigInt(0);
  const setupMissing = !cur ? "No default currency is set. The Owner must choose one in System Settings." : data.customers.length === 0 ? "There are no customers yet. Add a customer to start selling." : data.warehouses.length === 0 ? "There are no warehouses yet." : data.accounts.length === 0 ? `There is no active cash/bank account in ${cur.code}. Create one in Cash & Bank Accounts.` : data.products.length === 0 ? "There are no products yet." : "";
  // ---- split payment preview (the server re-validates everything and only trusts ids + exact amounts) ----
  const amountOf = (t: Tender, i: number) => (tenders.length === 1 && i === 0 ? totals.grandTotal : t.amount);
  const grandUnits = grandOk ? toUnits(totals.grandTotal, 2) : BigInt(0);
  const paidUnits = tenders.reduce((n, t, i) => {
    const a = amountOf(t, i);
    return MONEY_RE.test(a) ? n + toUnits(a, 2) : n;
  }, BigInt(0));
  const remainingUnits = grandUnits - paidUnits;
  // A CASH tender needs a CASH account with an OPEN register session (the server enforces this atomically).
  const registerProblem = (t: Tender) => {
    if (t.method !== "Cash" || !t.account) return undefined;
    const acc = data.accounts.find((x) => x.id === t.account);
    if (acc && acc.type !== "CASH") return "Cash payments must be deposited to a Cash account - choose a cash account or another payment type";
    return openFor(t.account) ? undefined : "Open a register for this cash account first";
  };
  const tenderError = tenders.map((t, i) => {
    const a = amountOf(t, i);
    const dup = tenders.some((o, j) => j !== i && o.account && o.account === t.account && o.method === t.method) ? "Each account and payment method can appear only once - combine the amounts" : undefined;
    return {
      account: t.account ? undefined : "Choose the account the payment is deposited to",
      amount: !MONEY_RE.test(a) ? "Enter an amount with up to 2 decimals" : toUnits(a, 2) <= BigInt(0) ? "The amount must be greater than 0" : undefined,
      dup,
      register: registerProblem(t),
    };
  });
  const tendersValid = tenders.length >= 1 && tenders.length <= MAX_TENDERS && tenderError.every((e) => !e.account && !e.amount && !e.dup && !e.register) && remainingUnits === BigInt(0);
  const updateTender = (key: string, patch: Partial<Tender>) => setTenders((l) => l.map((t) => (t.key === key ? { ...t, ...patch } : t)));
  const addTender = () => setTenders((l) => (l.length >= MAX_TENDERS ? l : [...l.map((t, i) => (l.length === 1 && i === 0 ? { ...t, amount: totals.grandTotal } : t)), newTender("")]));
  const removeTender = (key: string) => setTenders((l) => (l.length <= 1 ? l : l.filter((t) => t.key !== key)));
  const fillRemaining = (key: string) =>
    setTenders((l) => {
      const idx = l.findIndex((t) => t.key === key);
      const others = l.reduce((n, t, i) => (i !== idx && MONEY_RE.test(t.amount) ? n + toUnits(t.amount, 2) : n), BigInt(0));
      const rest = grandUnits - others;
      return rest > BigInt(0) ? l.map((t) => (t.key === key ? { ...t, amount: fromUnits(rest, 2) } : t)) : l;
    });
  // Draft rows saved by Hold: only well-formed amounts, never anything the server would have to guess.
  const draftTenders = () => tenders.map((t, i) => ({ paymentMethod: t.method, cashBankAccountId: t.account, amount: MONEY_RE.test(amountOf(t, i)) && tenders.length > 1 ? amountOf(t, i) : "" }));

  const hasMissing = cart.some((l) => l.missing);
  const canPay = !setupMissing && grandOk && !!customer && !!warehouse && !hasMissing;
  const payReason = setupMissing || (hasMissing ? "Remove the unavailable products from the cart" : !customer ? "Choose a customer" : !warehouse ? "Choose a warehouse" : cart.length === 0 ? "The cart is empty" : "");

  function add(p: PosProduct) {
    const stock = stockOf.get(p.id) ?? 0;
    if (!warehouse) return toast.error("Choose a warehouse first", { id: "pos" });
    if (stock <= 0) return toast.error(`${p.name} is out of stock in this warehouse`, { id: "pos" });
    setCart((c) => {
      const f = c.find((l) => l.product.id === p.id);
      if (f) return c.map((l) => (l.product.id === p.id ? { ...l, qty: Math.min(Math.floor(stock) || 1, l.qty + 1) } : l));
      return [...c, { product: p, qty: 1 }];
    });
  }
  const step = (id: string, n: number) => setCart((c) => c.map((l) => (l.product.id === id ? { ...l, qty: Math.max(1, Math.min(Math.floor(stockOf.get(id) ?? 1) || 1, l.qty + n)) } : l)));
  const remove = (id: string) => setCart((c) => c.filter((l) => l.product.id !== id));
  const reset = () => {
    setCart([]);
    setHeldId("");
    setProblems([]);
  };

  function hold() {
    if (cart.length === 0) return toast.error("The cart is empty — nothing to hold", { id: "pos" });
    const key = holdKeyRef.current ?? (holdKeyRef.current = crypto.randomUUID());
    startTransition(async () => {
      try {
        const r = await holdPosOrder({ holdKey: key, heldOrderId: heldId, customerId: customer, warehouseId: warehouse, tenders: draftTenders(), notes, items: cart.map((l) => ({ productId: l.product.id, quantity: String(l.qty) })) });
        if (!r.ok) return void toast.error(r.message, { id: "pos" });
        holdKeyRef.current = null;
        toast.success(r.message, { id: "pos" });
        setHeld(r.orders);
        setCart([]);
        setTenders([]);
        setHeldId("");
        setProblems([]);
        setNotes("");
      } catch {
        toast.error("Couldn't confirm the hold. Press Hold again — it won't create a duplicate.", { id: "pos" });
      }
    });
  }
  function resume(h: HeldOrderSummary) {
    startTransition(async () => {
      try {
        const r = await resumeHeldOrder(h.id);
        if (!r.ok) {
          toast.error(r.message, { id: "pos" });
          setHeld((l) => l.filter((x) => x.id !== h.id));
          return;
        }
        const o = r.order;
        const byId = new Map(data.products.map((p) => [p.id, p]));
        const extra: string[] = [];
        const lines: CartLine[] = o.lines.map((l) => {
          const p = byId.get(l.productId);
          if (p && !l.missing) return { product: p, qty: Number(l.quantity) };
          if (!l.missing) extra.push(`${l.code} ${l.name} isn't in this screen yet — refresh the POS.`);
          return { product: { id: l.productId, code: l.code, name: l.name, price: "0.00", taxType: "EXCLUSIVE", taxRate: "0.00", unit: "", category: "", brand: "", image: null }, qty: Number(l.quantity), missing: true };
        });
        setCart(lines);
        setCustomer(o.customerId);
        setWarehouse(o.warehouseId);
        setTenders(o.tenders.map((t) => newTender(t.amount, (PAYMENT_METHODS as readonly string[]).includes(t.paymentMethod) ? (t.paymentMethod as Method) : "Cash", t.cashBankAccountId)));
        setNotes(o.notes);
        setHeldId(o.id);
        setProblems([...o.problems, ...extra]);
        setShowHeld(false);
        toast.success(`Order ${o.reference} resumed — stock is not reserved and is checked again at checkout`, { id: "pos" });
      } catch {
        toast.error("Couldn't load the held order. Try again.", { id: "pos" });
      }
    });
  }
  function confirmDiscard() {
    const h = discard;
    if (!h) return;
    startTransition(async () => {
      try {
        const r = await discardHeldOrder(h.id);
        setDiscard(null);
        if (!r.ok) {
          toast.error(r.message, { id: "pos" });
          setHeld((l) => l.filter((x) => x.id !== h.id));
          return;
        }
        setHeld(r.orders);
        if (heldId === h.id) {
          setHeldId("");
          setProblems([]);
        }
        toast.success(`Held order ${h.reference} discarded`, { id: "pos" });
      } catch {
        toast.error("Couldn't discard the order. Try again.", { id: "pos" });
      }
    });
  }
  function doOpenRegister() {
    if (!regAccount) return setRegErr("Choose a cash account");
    setRegErr("");
    startTransition(async () => {
      try {
        const r = await openRegister({ cashBankAccountId: regAccount, openingCash: openingCash.trim(), notes: openNotes });
        if (!r.ok) {
          setRegErr(r.message);
          return void toast.error(r.message, { id: "pos" });
        }
        setRegisters({ open: r.open, history: r.history, movements: r.movements });
        setOpeningCash("");
        setOpenNotes("");
        toast.success(r.message, { id: "pos" });
      } catch {
        setRegErr("Could not open the register. Try again.");
      }
    });
  }
  function doMovement() {
    if (!curReg || !moveType) return;
    if (!moveAccount) return setRegErr(moveType === "CASH_IN" ? "Choose the source account" : "Choose the destination account");
    if (!moveNotes.trim()) return setRegErr("A reason is required");
    setRegErr("");
    startTransition(async () => {
      try {
        const r = await recordRegisterMovement({ sessionId: curReg.id, type: moveType, counterAccountId: moveAccount, amount: moveAmount.trim(), notes: moveNotes });
        if (!r.ok) {
          setRegErr(r.message);
          return void toast.error(r.message, { id: "pos" });
        }
        setRegisters({ open: r.open, history: r.history, movements: r.movements });
        setMoveType(null);
        setMoveAmount("");
        setMoveNotes("");
        setMoveAccount("");
        toast.success(r.message, { id: "pos" });
      } catch {
        setRegErr("Could not record the movement. Try again.");
      }
    });
  }
  function doCloseRegister() {
    if (!curReg) return;
    setRegErr("");
    startTransition(async () => {
      try {
        if (denoms.length && !countsValid) {
          setRegErr("Each count must be a whole number (0 or more).");
          return;
        }
        const r = await closeRegister(denoms.length ? { sessionId: curReg.id, counts: denoms.map((x) => ({ denominationId: x.id, count: countOf(x.id) ?? 0 })), notes: closeNotes } : { sessionId: curReg.id, closingCash: closingCash.trim(), notes: closeNotes });
        if (!r.ok) {
          setRegErr(r.message);
          return void toast.error(r.message, { id: "pos" });
        }
        setRegisters({ open: r.open, history: r.history, movements: r.movements });
        setClosingCash("");
        setCounts({});
        setCloseNotes("");
        toast.success(r.message, { id: "pos" });
      } catch {
        setRegErr("Could not close the register. Try again.");
      }
    });
  }
  function unlockWithPin() {
    if (!lockPin) return setLockErr("Enter your PIN");
    startTransition(async () => {
      try {
        const r = await unlockPosWithPin({ pin: lockPin });
        setLockPin("");
        if (!r.ok) return void setLockErr(r.message);
        setLockErr("");
        setLocked(false);
      } catch {
        setLockPin("");
        setLockErr("Could not verify right now. Try again.");
      }
    });
  }
  function unlock() {
    if (!lockPw) return setLockErr("Enter your password");
    startTransition(async () => {
      try {
        const r = await unlockPos({ password: lockPw });
        setLockPw("");
        if (!r.ok) return void setLockErr(r.message);
        setLockErr("");
        setLocked(false);
      } catch {
        setLockPw("");
        setLockErr("Couldn't verify right now. Try again.");
      }
    });
  }

  function onSearchKey(ev: React.KeyboardEvent) {
    if (ev.key !== "Enter") return;
    ev.preventDefault();
    // Barcode scanners type the code and press Enter: an exact code match (or the only match) is added.
    const exact = data.products.find((p) => p.code.toLowerCase() === needle) ?? (list.length === 1 ? list[0] : undefined);
    if (exact) {
      add(exact);
      setQ("");
    } else toast.error(needle ? "No product matches that code" : "Type or scan a product code", { id: "pos" });
  }

  function openPay() {
    if (!canPay) return toast.error(payReason || "Complete the sale details first", { id: "pos" });
    setErr("");
    keyRef.current ??= crypto.randomUUID();
    setTenders((l) => (l.length ? l : [newTender(totals.grandTotal)]));
    setPay(true);
  }
  function cancelPay() {
    if (pending) return;
    keyRef.current = null;
    setPay(false);
  }
  function submit() {
    if (!tendersValid) return setErr("The payments must add up to exactly the sale total, each with an account.");
    setErr("");
    const key = keyRef.current ?? (keyRef.current = crypto.randomUUID());
    startTransition(async () => {
      try {
        const r = await posCheckout({ checkoutKey: key, customerId: customer, warehouseId: warehouse, tenders: tenders.map((t, i) => ({ paymentMethod: t.method, cashBankAccountId: t.account, amount: amountOf(t, i) })), notes, heldOrderId: heldId, walkIn: isWalkIn, items: cart.map((l) => ({ productId: l.product.id, quantity: String(l.qty) })) });
        if (!r.ok) {
          setErr(r.message);
          toast.error(r.message, { id: "pos" });
          return; // definite refusal: nothing was written, the same key stays valid for a retry
        }
        toast.success(r.message, { id: "pos" });
        void getRegisters().then((g) => g.ok && setRegisters({ open: g.open, history: g.history, movements: g.movements })); // cash sales this shift
        keyRef.current = null;
        setPay(false);
        setCart([]);
        setTenders([]);
        setNotes("");
        if (heldId) setHeld((l) => l.filter((x) => x.id !== heldId));
        setHeldId("");
        setProblems([]);
        setDone({ saleId: r.saleId, reference: r.reference, replayed: r.replayed });
      } catch {
        // Outcome unknown (network): keep the key — pressing Submit again can never double-charge.
        const msg = "Couldn't confirm the checkout. Press Submit again — it is safe to retry and won't charge twice.";
        setErr(msg);
        toast.error(msg, { id: "pos" });
      }
    });
  }
  function toggleFs() {
    if (document.fullscreenElement) void document.exitFullscreen().then(() => setFs(false));
    else void document.documentElement.requestFullscreen().then(() => setFs(true)).catch(() => toast.error("Fullscreen isn't available in this browser", { id: "pos" }));
  }

  if (locked) {
    // Nothing from the POS (cart, products, customer, payment) is rendered while locked — the state
    // lives in this component, so the exact cart is back as soon as the password is accepted.
    return (
      <div className="pos-lock" role="dialog" aria-modal="true" aria-label="POS locked" data-testid="pos-lock">
        <form
          className="pos-lock-card"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (lockMode === "pin") unlockWithPin();
            else unlock();
          }}
        >
          <div className="pos-lock-brand">Sontic Plus</div>
          <div className="pos-lock-icon">
            <Icon name="lock" size={40} />
          </div>
          <div style={{ textAlign: "center" }}>
            <h2 className="t-section-title" style={{ margin: 0 }}>POS Locked</h2>
            <p className="t-body" style={{ margin: "6px 0 0", color: "var(--text-2)" }}>{lockMode === "pin" ? "Enter your POS PIN to continue" : "Enter your account password to continue"}</p>
            <p className="t-caption" style={{ margin: "6px 0 0" }}>Signed in as {data.userName}</p>
          </div>
          {lockMode === "pin" ? (
            <div className="sp-field" style={{ width: "100%" }}>
              <label className="sp-label" htmlFor="pos-unlock-pin">PIN</label>
              <input id="pos-unlock-pin" data-testid="pos-unlock-pin" type="password" className="sp-input" inputMode="numeric" pattern="[0-9]*" maxLength={8} autoComplete="off" autoFocus value={lockPin} onChange={(e) => { setLockPin(e.target.value.replace(/\D/g, "").slice(0, 8)); setLockErr(""); }} disabled={pending} />
            </div>
          ) : (
            <div className="sp-field" style={{ width: "100%" }}>
              <label className="sp-label" htmlFor="pos-unlock-pw">Password</label>
              <input id="pos-unlock-pw" type="password" className="sp-input" autoComplete="current-password" autoFocus value={lockPw} onChange={(e) => { setLockPw(e.target.value); setLockErr(""); }} disabled={pending} />
            </div>
          )}
          <div role="alert" data-testid="pos-lock-error" style={{ minHeight: 20, font: "500 13px/20px var(--font-body)", color: "var(--danger-500)" }}>{lockErr}</div>
          <button type="submit" className="sp-btn sp-btn--primary" style={{ width: "100%" }} disabled={pending} data-testid="pos-unlock">
            <Icon name="lock" size={18} />
            {pending ? "Checking…" : lockMode === "pin" ? "Unlock with PIN" : "Unlock"}
          </button>
          {data.hasPin ? (
            <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm" data-testid="pos-lock-switch" disabled={pending} onClick={() => { setLockMode(lockMode === "pin" ? "password" : "pin"); setLockErr(""); setLockPw(""); setLockPin(""); }}>
              {lockMode === "pin" ? "Use password instead" : "Unlock with PIN"}
            </button>
          ) : (
            <p className="t-caption" data-testid="pos-pin-hint" style={{ margin: 0, textAlign: "center" }}>
              Want a faster unlock? Set a POS PIN in <Link href="/profile" target="_blank" rel="noopener">Profile</Link> (opens in a new tab so your cart is kept).
            </p>
          )}
          <p className="t-caption" style={{ margin: 0, textAlign: "center" }}>This only locks the POS screen in this tab. You stay signed in and your cart is kept.</p>
        </form>
      </div>
    );
  }

  return (
    <div className="pos">
      <div className="pos-col">
        <div className="pos-top" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 15 }}>
          <div className="pos-panel" style={{ display: "flex", alignItems: "center", gap: 10, height: 74 }}>
            <Icon name="user" size={20} />
            <select aria-label="Customer" className="sp-select" style={{ border: 0, boxShadow: "none", fontSize: 16 }} value={customer} onChange={(e) => setCustomer(e.target.value)}>
              <option value="">Select customer</option>
              {data.customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.id === walkInId ? " (Walk-in Customer)" : ""}
                </option>
              ))}
            </select>
            {isWalkIn && (
              <span className="sp-badge sp-badge--info" data-testid="pos-walkin-badge" style={{ whiteSpace: "nowrap" }}>
                Walk-in Customer
              </span>
            )}
            {walkInId && !isWalkIn && (
              <button type="button" className="sp-btn sp-btn--secondary sp-btn--sm" data-testid="pos-use-walkin" style={{ whiteSpace: "nowrap" }} onClick={() => setCustomer(walkInId)}>
                <Icon name="user" size={16} />
                Use Walk-in Customer
              </button>
            )}
            <Link href="/customers/create" aria-label="Add customer" title="Add customer" style={{ color: "var(--primary-600)", display: "grid", placeItems: "center" }}>
              <Icon name="plus" size={20} />
            </Link>
          </div>
          <div className="pos-panel" style={{ display: "flex", alignItems: "center", gap: 10, height: 74 }}>
            <Icon name="warehouse" size={20} />
            <select aria-label="Warehouse" className="sp-select" style={{ border: 0, boxShadow: "none", fontSize: 16 }} value={warehouse} onChange={(e) => { setWarehouse(e.target.value); reset(); }}>
              <option value="">Select warehouse</option>
              {data.warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="pos-panel" data-testid="pos-register-bar" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "10px 15px" }}>
          <Icon name="wallet" size={20} />
          {cashAccounts.length === 0 ? (
            <span className="t-caption">No active Cash account in {cur?.code ?? "the sale currency"} - create one in Cash &amp; Bank to track a register shift.</span>
          ) : (
            <>
              {cashAccounts.length > 1 && (
                <select aria-label="Register cash account" className="sp-select" style={{ width: "auto", minWidth: 150 }} value={regAccount} onChange={(e) => setRegAccount(e.target.value)}>
                  {cashAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              )}
              <b data-testid="pos-register-account">{cashAccounts.find((a) => a.id === regAccount)?.name}</b>
              <span className={`sp-badge sp-badge--${curReg ? "success" : "neutral"}`} data-testid="pos-register-state">
                {curReg ? "OPEN" : "CLOSED"}
              </span>
              {curReg ? (
                <span className="t-caption" data-testid="pos-register-figures">
                  {curReg.reference} · Opening {m(curReg.openingCash)} · Cash sales {m(curReg.cashSales)} · In {m(curReg.cashIn)} · Out {m(curReg.cashOut)} · Expected {m(curReg.expected)}
                </span>
              ) : (
                <span className="t-caption">No open register - cash payments are blocked for this account.</span>
              )}
              <button type="button" className="sp-btn sp-btn--secondary sp-btn--sm" data-testid="pos-register-open-modal" style={{ marginLeft: "auto" }} onClick={() => setShowRegister(true)}>
                {curReg ? "Close Register" : "Open Register"}
              </button>
            </>
          )}
        </div>
        <div className="pos-panel pos-cart">
          {setupMissing && (
            <div role="alert" data-testid="pos-setup" style={{ background: "var(--warning-50, #fffbeb)", border: "1px solid var(--warning-500, #f59e0b)", borderRadius: 8, padding: "10px 12px", marginBottom: 10, font: "500 14px/20px var(--font-body)" }}>
              {setupMissing}
            </div>
          )}
          {!walkInId && data.customers.length > 0 && (
            <div className="t-caption" data-testid="pos-walkin-hint" style={{ marginBottom: 8 }}>
              {data.canConfigureWalkIn ? (
                <>
                  No Walk-in Customer is set. <Link href="/settings">Choose one in System Settings</Link> to speed up anonymous sales.
                </>
              ) : (
                "No Walk-in Customer is set. Ask the Owner to choose one in System Settings."
              )}
            </div>
          )}
          {problems.length > 0 && (
            <div role="alert" data-testid="pos-problems" style={{ background: "var(--danger-50, #fef2f2)", border: "1px solid var(--danger-500)", borderRadius: 8, padding: "10px 12px", marginBottom: 10, font: "500 14px/20px var(--font-body)" }}>
              {problems.map((x) => (
                <div key={x}>{x}</div>
              ))}
            </div>
          )}
          {heldId && (
            <div className="t-caption" data-testid="pos-resumed" style={{ marginBottom: 6 }}>
              Resumed from a held order — completing the sale uses it up.
            </div>
          )}
          <div style={{ flex: 1, overflow: "auto" }}>
            <table data-testid="pos-cart">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Qty</th>
                  <th>Price</th>
                  <th>Sub Total</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {cart.length === 0 && (
                  <tr>
                    <td colSpan={5} data-testid="pos-empty" style={{ color: "var(--text-3)", textAlign: "center", padding: 40 }}>
                      Scan or select a product to start
                    </td>
                  </tr>
                )}
                {cart.map((l, n) => (
                  <tr key={l.product.id} data-code={l.product.code} data-missing={l.missing ? "true" : undefined} style={l.missing ? { background: "var(--danger-50, #fef2f2)" } : undefined}>
                    <td>
                      <div style={{ font: "600 15px/20px var(--font-body)", maxWidth: 190, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.product.name}</div>
                      <span className="sp-badge sp-badge--info">{l.product.code}</span>
                    </td>
                    <td>
                      <span className="pos-step">
                        <button type="button" aria-label={`Decrease ${l.product.name}`} onClick={() => step(l.product.id, -1)}>
                          −
                        </button>
                        <b data-testid="pos-qty" style={{ fontWeight: 600, minWidth: 14, textAlign: "center" }}>{l.qty}</b>
                        <button type="button" aria-label={`Increase ${l.product.name}`} onClick={() => step(l.product.id, 1)}>
                          +
                        </button>
                      </span>
                    </td>
                    <td>{l.missing ? "Unavailable" : m(l.product.price)}</td>
                    <td>{m(totals.lines[n]?.subtotal ?? "0.00")}</td>
                    <td>
                      <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm sp-btn--icon" aria-label={`Remove ${l.product.name}`} style={{ color: "var(--danger-500)" }} onClick={() => remove(l.product.id)}>
                        <Icon name="trash-2" size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pos-calc" style={{ display: "grid", gridTemplateColumns: "1fr", gap: 16, paddingTop: 16 }}>
            <div className="pos-sum" aria-live="polite">
              <div>
                Total QTY : <b data-testid="pos-total-qty">{qtyTotal}</b>
              </div>
              <div>
                Sub Total : <b>{m(totals.subtotal)}</b>
              </div>
              <div style={{ fontSize: 26, marginTop: 6 }}>
                Total : <b data-testid="pos-total">{m(totals.grandTotal)}</b>
              </div>
            </div>
          </div>
          <div className="pos-acts" style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <button type="button" className="sp-btn pos-big" data-testid="pos-hold" style={{ background: "var(--tone-rose)", color: "#fff" }} onClick={hold} disabled={cart.length === 0 || pending}>
              <Icon name="clock" size={18} />
              Hold
            </button>
            <button type="button" className="sp-btn pos-big" style={{ background: "var(--danger-500)", color: "#fff" }} onClick={reset} disabled={cart.length === 0}>
              <Icon name="rotate-ccw" size={18} />
              Reset
            </button>
            <button type="button" className="sp-btn pos-big" data-testid="pos-pay" style={{ background: "var(--tone-green)", color: "#fff" }} disabled={!canPay} title={payReason || undefined} onClick={openPay}>
              <Icon name="banknote" size={18} />
              Pay Now
            </button>
          </div>
        </div>
      </div>

      <div className="pos-col">
        <div className="pos-bar" style={{ display: "flex", gap: 15 }}>
          <div className="pos-panel pos-search" style={{ flex: 1, display: "flex", alignItems: "center", gap: 10, height: 75, padding: "0 20px" }}>
            <Icon name="search" size={20} />
            <input ref={searchRef} className="sp-input" aria-label="Scan or search product by code or name" placeholder="Scan/Search Product by Code Name" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onSearchKey} style={{ border: 0, boxShadow: "none", height: 50, fontSize: 17 }} autoFocus />
          </div>
          <button type="button" className="pos-tool" data-testid="pos-held-btn" style={{ background: "var(--tone-rose)" }} title="Held orders" aria-label={`Held orders (${held.length})`} onClick={() => setShowHeld(true)}>
            <Icon name="list" size={30} />
            <span style={{ position: "absolute", top: -6, right: -6, minWidth: 28, height: 28, borderRadius: 14, background: "var(--primary-600)", color: "#fff", font: "700 13px/28px var(--font-body)", textAlign: "center", border: "2px solid #fff" }} data-testid="pos-held-count">{held.length}</span>
          </button>
          <button type="button" className="pos-tool" data-testid="pos-register-btn" style={{ background: "var(--tone-green)" }} title="Register details" aria-label="Register details" onClick={() => { setRegErr(""); setShowRegister(true); }}>
            <Icon name="wallet" size={30} />
          </button>
          <button type="button" className="pos-tool" data-testid="pos-lock-btn" style={{ background: "var(--primary-600)" }} title="Lock Screen" aria-label="Lock Screen" disabled={pending} onClick={() => { setLockPw(""); setLockPin(""); setLockErr(""); setLockMode(data.hasPin ? "pin" : "password"); setLocked(true); }}>
            <Icon name="lock" size={30} />
          </button>
          <button type="button" className="pos-tool" style={{ background: "var(--primary-600)" }} title={fs ? "Exit fullscreen" : "Fullscreen"} aria-label={fs ? "Exit fullscreen" : "Fullscreen"} onClick={toggleFs}>
            <Icon name="maximize" size={30} />
          </button>
          <Link href="/dashboard" className="pos-tool" style={{ background: "var(--primary-600)" }} title="Dashboard" aria-label="Dashboard">
            <Icon name="layout-dashboard" size={30} />
          </Link>
        </div>
        <div className="pos-panel" style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          <div className="pos-chips">
            <button type="button" className="pos-chip" aria-pressed={cat === "all"} onClick={() => setCat("all")}>
              All Categories
            </button>
            {data.categories.map((c) => (
              <button key={c} type="button" className="pos-chip" aria-pressed={cat === c} onClick={() => setCat(c)}>
                {c}
              </button>
            ))}
          </div>
          <div className="pos-chips">
            <button type="button" className="pos-chip" aria-pressed={brand === "all"} onClick={() => setBrand("all")}>
              All Brands
            </button>
            {data.brands.map((b) => (
              <button key={b} type="button" className="pos-chip" aria-pressed={brand === b} onClick={() => setBrand(b)}>
                {b}
              </button>
            ))}
          </div>
          <div className="pos-grid" data-testid="pos-grid">
            {list.map((p) => {
              const stock = stockOf.get(p.id) ?? 0;
              return (
                <button key={p.id} type="button" className="pos-card" data-code={p.code} aria-pressed={cart.some((l) => l.product.id === p.id)} disabled={!!warehouse && stock <= 0} onClick={() => add(p)}>
                  <span className="pos-tag" style={{ left: 0, background: "var(--tone-blue)", borderRadius: "6px 0 6px 0" }}>{m(p.price)}</span>
                  <span className="pos-tag" style={{ right: 0, background: "var(--tone-cyan)", borderRadius: "0 6px 0 6px" }}>{warehouse ? `${stock} ${p.unit}` : "—"}</span>
                  {p.image ? (
                    // eslint-disable-next-line @next/next/no-img-element -- runtime upload under /uploads
                    <img src={p.image} alt="" className="pos-img" />
                  ) : (
                    <span className="sp-thumb" />
                  )}
                  <div className="nm">{p.name}</div>
                  <div className="cd">{p.code}</div>
                </button>
              );
            })}
          </div>
          {list.length === 0 && (
            <div style={{ color: "var(--text-3)", padding: 24, display: "flex", alignItems: "center", gap: 16 }} data-testid="pos-nomatch">
              No products match the current search and filters.
              <button type="button" className="sp-btn sp-btn--secondary sp-btn--sm" onClick={() => { setQ(""); setCat("all"); setBrand("all"); }}>
                Clear filters
              </button>
            </div>
          )}
        </div>
      </div>

      {showHeld && (
        <Modal size="md" title="Held Orders" onClose={() => setShowHeld(false)} footer={<button type="button" className="sp-btn sp-btn--secondary" onClick={() => setShowHeld(false)}>Close</button>}>
          {held.length === 0 ? (
            <div style={{ color: "var(--text-3)" }} data-testid="pos-held-empty">No held orders.</div>
          ) : (
            held.map((h) => (
              <div key={h.id} data-testid="pos-held-row" data-ref={h.reference} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 0", borderBottom: "1px solid var(--border)" }}>
                <span>
                  <b style={{ fontWeight: 600 }}>{h.reference}</b> · {h.lines} item{h.lines === 1 ? "" : "s"} (qty {h.quantity}) · {m(h.total)}
                  <span className="t-caption" style={{ display: "block" }}>
                    {h.customerName ?? "No customer yet"} · {h.createdOn}
                  </span>
                </span>
                <span style={{ display: "flex", gap: 8 }}>
                  <button type="button" className="sp-btn sp-btn--primary sp-btn--sm" disabled={pending || h.id === heldId} onClick={() => resume(h)}>
                    {h.id === heldId ? "In cart" : "Resume"}
                  </button>
                  <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm sp-btn--icon" aria-label={`Discard ${h.reference}`} style={{ color: "var(--danger-500)" }} disabled={pending} onClick={() => setDiscard(h)}>
                    <Icon name="trash-2" size={16} />
                  </button>
                </span>
              </div>
            ))
          )}
        </Modal>
      )}
      {showRegister && (
        <Modal size="lg" title="Register Details" onClose={() => setShowRegister(false)} footer={<button type="button" className="sp-btn sp-btn--secondary" onClick={() => setShowRegister(false)}>Close</button>}>
          <div data-testid="pos-register-modal" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {cashAccounts.length === 0 ? (
              <div className="t-caption">There is no active Cash account in {cur?.code ?? "the sale currency"}. Create one in Cash &amp; Bank first.</div>
            ) : (
              <div className="sp-card" style={{ padding: 16 }}>
                <div className="sp-field" style={{ maxWidth: 320 }}>
                  <label className="sp-label" htmlFor="pos-reg-account">Cash account</label>
                  <select id="pos-reg-account" className="sp-select" value={regAccount} onChange={(e) => { setRegAccount(e.target.value); setRegErr(""); }}>
                    {cashAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>
                {curReg ? (
                  <div style={{ marginTop: 12 }}>
                    <p className="t-body" style={{ margin: 0 }} data-testid="pos-reg-summary">
                      <b>{curReg.reference}</b> is <b>OPEN</b> since {curReg.openedAt} by {curReg.openedBy}. Opening {m(curReg.openingCash)} + cash sales {m(curReg.cashSales)} + cash in {m(curReg.cashIn)} - cash out {m(curReg.cashOut)} = expected <b>{m(curReg.expected)}</b>.
                    </p>
                    <div data-testid="pos-reg-movements-box" style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button type="button" className="sp-btn sp-btn--secondary sp-btn--sm" data-testid="pos-cash-in" aria-pressed={moveType === "CASH_IN"} disabled={pending} onClick={() => { setMoveType("CASH_IN"); setMoveAccount(""); setRegErr(""); }}>
                        <Icon name="arrow-down-to-line" size={16} />
                        Cash In
                      </button>
                      <button type="button" className="sp-btn sp-btn--secondary sp-btn--sm" data-testid="pos-cash-out" aria-pressed={moveType === "CASH_OUT"} disabled={pending} onClick={() => { setMoveType("CASH_OUT"); setMoveAccount(""); setRegErr(""); }}>
                        <Icon name="arrow-up-from-line" size={16} />
                        Cash Out
                      </button>
                    </div>
                    {moveType && (
                      <div className="sp-form-grid" style={{ marginTop: 12 }} data-testid="pos-move-form">
                        <div className="sp-field">
                          <label className="sp-label" htmlFor="pos-move-account">{moveType === "CASH_IN" ? "Source account" : "Destination account"}<i>*</i></label>
                          <select id="pos-move-account" className="sp-select" value={moveAccount} onChange={(e) => setMoveAccount(e.target.value)}>
                            <option value="">Select account</option>
                            {data.accounts.filter((a) => a.id !== regAccount).map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="sp-field">
                          <label className="sp-label" htmlFor="pos-move-amount">Amount<i>*</i></label>
                          <input id="pos-move-amount" className="sp-input" inputMode="decimal" autoComplete="off" value={moveAmount} onChange={(e) => setMoveAmount(e.target.value)} />
                        </div>
                        <div className="sp-field sp-span-all">
                          <label className="sp-label" htmlFor="pos-move-notes">Reason<i>*</i></label>
                          <input id="pos-move-notes" className="sp-input" maxLength={500} value={moveNotes} onChange={(e) => setMoveNotes(e.target.value)} />
                        </div>
                        <div className="sp-span-all" style={{ display: "flex", gap: 8 }}>
                          <button type="button" className="sp-btn sp-btn--primary sp-btn--sm" data-testid="pos-move-submit" disabled={pending} onClick={doMovement}>
                            Record {MOVEMENT_LABEL[moveType]}
                          </button>
                          <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm" onClick={() => setMoveType(null)}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                    {denoms.length > 0 && (
                      <div style={{ marginTop: 12 }} data-testid="pos-denoms">
                        <div className="t-section-title" style={{ marginBottom: 6 }}>Count the drawer</div>
                        <table className="sp-table">
                          <thead>
                            <tr>
                              <th>Denomination</th>
                              <th>Count</th>
                              <th className="num">Line total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {denoms.map((x) => (
                              <tr key={x.id} data-value={x.value}>
                                <td>
                                  <b>{m(x.value)}</b>
                                  {x.label && <span className="t-caption"> · {x.label}</span>}
                                </td>
                                <td>
                                  <input className="sp-input" style={{ width: 110 }} inputMode="numeric" autoComplete="off" aria-label={`Count of ${x.value}`} data-testid="pos-denom-count" value={counts[x.id] ?? ""} placeholder="0" onChange={(e) => setCounts((c) => ({ ...c, [x.id]: e.target.value }))} />
                                </td>
                                <td className="num" data-testid="pos-denom-line">
                                  {m(x.value)} × {countOf(x.id) ?? "?"} = <b>{countOf(x.id) === null ? "—" : m(fromUnits(toUnits(x.value, 2) * BigInt(countOf(x.id) ?? 0), 2))}</b>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr style={{ fontWeight: 700 }}>
                              <td colSpan={2}>Actual cash counted</td>
                              <td className="num" data-testid="pos-denom-total">{countsValid ? m(fromUnits(countedUnits, 2)) : "—"}</td>
                            </tr>
                          </tfoot>
                        </table>
                        <p className="t-caption" style={{ margin: "6px 0 0" }} data-testid="pos-denom-diff">
                          {countsValid ? `Difference vs expected ${m(curReg.expected)}: ${m(fromUnits(countedUnits - toUnits(curReg.expected, 2), 2))}` : "Enter whole numbers only."}
                        </p>
                      </div>
                    )}
                    {denoms.length === 0 && (
                      <p className="t-caption" data-testid="pos-denom-hint" style={{ margin: "10px 0 0" }}>
                        {data.isOwner ? (
                          <>
                            No cash denominations are set for {cur?.code ?? "this currency"}, so type the counted cash. <Link href="/settings/denominations">Set up denominations</Link> to count by banknote and coin.
                          </>
                        ) : (
                          "No cash denominations are set up for this currency, so type the counted cash. Ask the Owner to set them up in Settings."
                        )}
                      </p>
                    )}
                    <div className="sp-form-grid" style={{ marginTop: 12 }}>
                      {denoms.length === 0 && (
                        <div className="sp-field">
                          <label className="sp-label" htmlFor="pos-reg-closing">Counted cash<i>*</i></label>
                          <input id="pos-reg-closing" className="sp-input" inputMode="decimal" autoComplete="off" value={closingCash} onChange={(e) => setClosingCash(e.target.value)} />
                        </div>
                      )}
                      <div className="sp-field">
                        <label className="sp-label" htmlFor="pos-reg-closenotes">Closing notes{(denoms.length ? countsValid && countedUnits !== toUnits(curReg.expected, 2) : closingCash.trim() !== "" && /^\d+(\.\d{1,2})?$/.test(closingCash.trim()) && toUnits(closingCash.trim(), 2) !== toUnits(curReg.expected, 2)) ? " (required: counted cash differs)" : ""}</label>
                        <input id="pos-reg-closenotes" className="sp-input" maxLength={1000} value={closeNotes} onChange={(e) => setCloseNotes(e.target.value)} />
                      </div>
                    </div>
                    <button type="button" className="sp-btn sp-btn--primary" data-testid="pos-reg-close" style={{ marginTop: 12 }} disabled={pending} onClick={doCloseRegister}>
                      Close Register
                    </button>
                  </div>
                ) : (
                  <div style={{ marginTop: 12 }}>
                    <p className="t-body" style={{ margin: 0 }}>No open register for this account. Opening cash is a count of the drawer - it does not create any ledger entry.</p>
                    <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <button type="button" className="sp-btn sp-btn--secondary sp-btn--sm" data-testid="pos-cash-in-disabled" disabled title="Open a register for this account first">Cash In</button>
                      <button type="button" className="sp-btn sp-btn--secondary sp-btn--sm" data-testid="pos-cash-out-disabled" disabled title="Open a register for this account first">Cash Out</button>
                      <span className="t-caption">Cash In and Cash Out need an open register session.</span>
                    </div>
                    <div className="sp-form-grid" style={{ marginTop: 12 }}>
                      <div className="sp-field">
                        <label className="sp-label" htmlFor="pos-reg-opening">Opening cash<i>*</i></label>
                        <input id="pos-reg-opening" className="sp-input" inputMode="decimal" autoComplete="off" value={openingCash} onChange={(e) => setOpeningCash(e.target.value)} />
                      </div>
                      <div className="sp-field">
                        <label className="sp-label" htmlFor="pos-reg-opennotes">Opening notes</label>
                        <input id="pos-reg-opennotes" className="sp-input" maxLength={1000} value={openNotes} onChange={(e) => setOpenNotes(e.target.value)} />
                      </div>
                    </div>
                    <button type="button" className="sp-btn sp-btn--primary" data-testid="pos-reg-open" style={{ marginTop: 12 }} disabled={pending} onClick={doOpenRegister}>
                      Open Register
                    </button>
                  </div>
                )}
                {regErr && (
                  <div className="sp-error" role="alert" data-testid="pos-reg-error" style={{ marginTop: 10 }}>
                    {regErr}
                  </div>
                )}
              </div>
            )}
            <div>
              <div className="t-section-title" style={{ marginBottom: 8 }}>Cash In / Cash Out</div>
              <div style={{ overflow: "auto", maxHeight: 220, marginBottom: 16 }}>
                <table className="sp-table" data-testid="pos-move-history">
                  <thead>
                    <tr>
                      <th>Reference</th>
                      <th>Time</th>
                      <th>Type</th>
                      <th>From</th>
                      <th>To</th>
                      <th className="num">Amount</th>
                      <th>Reason</th>
                      <th>User</th>
                      <th>Register</th>
                    </tr>
                  </thead>
                  <tbody>
                    {registers.movements.length === 0 && (
                      <tr>
                        <td colSpan={9} style={{ textAlign: "center", color: "var(--text-2)" }}>No cash movements yet.</td>
                      </tr>
                    )}
                    {registers.movements.map((x) => (
                      <tr key={x.id} data-ref={x.reference}>
                        <td>{x.reference}<span className="t-caption" style={{ display: "block" }}>{x.transferReference}</span></td>
                        <td>{x.at}</td>
                        <td><span className={`sp-badge sp-badge--${x.type === "CASH_IN" ? "success" : "warning"}`}>{MOVEMENT_LABEL[x.type]}</span></td>
                        <td>{x.from}</td>
                        <td>{x.to}</td>
                        <td className="num">{m(x.amount)}</td>
                        <td>{x.notes}</td>
                        <td>{x.user}</td>
                        <td>
                          <Link href={`/reports/register-session/${encodeURIComponent(x.sessionId)}`} className="sp-btn sp-btn--ghost sp-btn--sm">
                            {x.sessionReference}
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="t-section-title" style={{ marginBottom: 8 }}>Session history</div>
              <div style={{ overflow: "auto", maxHeight: 280 }}>
                <table className="sp-table" data-testid="pos-reg-history">
                  <thead>
                    <tr>
                      <th>Reference</th>
                      <th>Account</th>
                      <th>Opened</th>
                      <th>Closed</th>
                      <th className="num">Opening</th>
                      <th className="num">Expected</th>
                      <th className="num">Actual</th>
                      <th className="num">Difference</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {registers.history.length === 0 && (
                      <tr>
                        <td colSpan={10} style={{ textAlign: "center", color: "var(--text-2)" }}>No register sessions yet.</td>
                      </tr>
                    )}
                    {registers.history.map((h) => (
                      <tr key={h.id} data-ref={h.reference}>
                        <td>{h.reference}</td>
                        <td>{h.accountName}</td>
                        <td>{h.openedAt}<span className="t-caption" style={{ display: "block" }}>{h.openedBy}</span></td>
                        <td>{h.closedAt ?? "—"}</td>
                        <td className="num">{m(h.openingCash)}</td>
                        <td className="num">{m(h.expected)}</td>
                        <td className="num">{h.actual ? m(h.actual) : "—"}</td>
                        <td className="num" data-col="difference">{h.difference ? m(h.difference) : "—"}</td>
                        <td>
                          <span className={`sp-badge sp-badge--${h.status === "OPEN" ? "success" : "neutral"}`}>{h.status}</span>
                        </td>
                        <td>
                          <Link href={`/reports/register-session/${encodeURIComponent(h.id)}`} className="sp-btn sp-btn--ghost sp-btn--sm" data-testid="pos-reg-report">
                            <Icon name="file-text" size={16} />
                            View Report
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </Modal>
      )}
      {discard && <ConfirmDeleteModal itemType="held order" itemName={discard.reference} busy={pending} onCancel={() => setDiscard(null)} onConfirm={confirmDiscard} />}

      {pay && (
        <Modal
          size="lg"
          title="Make Payment"
          onClose={cancelPay}
          footer={
            <>
              <button type="button" className="sp-btn sp-btn--secondary" onClick={cancelPay} disabled={pending}>
                Cancel
              </button>
              <button type="button" className="sp-btn sp-btn--primary" data-testid="pos-submit" onClick={submit} disabled={pending || !tendersValid} aria-busy={pending}>
                {pending ? "Processing…" : "Submit"}
              </button>
            </>
          }
        >
          <div className="pos-pay" style={{ display: "grid", gridTemplateColumns: "minmax(0,1.6fr) minmax(0,1fr)", gap: 32 }}>
            <div className="sp-form-grid">
              <div className="sp-field sp-span-all">
                <label className="sp-label" htmlFor="pos-paying">Paying Amount (Grand Total)</label>
                <input id="pos-paying" className="sp-input" disabled value={totals.grandTotal} readOnly />
              </div>
              <div className="sp-span-all" data-testid="pos-tenders" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {tenders.map((t, i) => {
                  const e = tenderError[i];
                  const single = tenders.length === 1;
                  return (
                    <fieldset key={t.key} data-testid="pos-tender" style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 12, margin: 0, minWidth: 0 }}>
                      <legend className="t-caption" style={{ padding: "0 6px" }}>{single ? "Payment" : `Payment ${i + 1}`}</legend>
                      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1.4fr) minmax(0,1fr)", gap: 10 }}>
                        <div className="sp-field">
                          <label className="sp-label" htmlFor={i === 0 ? "pos-method" : `pos-method-${i}`}>Payment Type<i>*</i></label>
                          <select id={i === 0 ? "pos-method" : `pos-method-${i}`} className="sp-select" value={t.method} onChange={(ev) => updateTender(t.key, { method: ev.target.value as (typeof PAYMENT_METHODS)[number] })}>
                            {PAYMENT_METHODS.map((x) => (
                              <option key={x} value={x}>
                                {x}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="sp-field">
                          <label className="sp-label" htmlFor={i === 0 ? "pos-account" : `pos-account-${i}`}>Deposit To<i>*</i></label>
                          <select id={i === 0 ? "pos-account" : `pos-account-${i}`} className="sp-select" value={t.account} aria-invalid={!!e?.account || undefined} aria-describedby={e?.account ? `pos-terr-${i}` : undefined} onChange={(ev) => updateTender(t.key, { account: ev.target.value })}>
                            <option value="">Select account</option>
                            {data.accounts.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="sp-field">
                          <label className="sp-label" htmlFor={`pos-amount-${i}`}>Amount<i>*</i></label>
                          <input id={`pos-amount-${i}`} data-testid="pos-tender-amount" className="sp-input" inputMode="decimal" autoComplete="off" disabled={single} value={amountOf(t, i)} aria-invalid={!!e?.amount || undefined} aria-describedby={e?.amount ? `pos-terr-${i}` : undefined} onChange={(ev) => updateTender(t.key, { amount: ev.target.value.trim() })} />
                        </div>
                      </div>
                      {(e?.account || e?.amount || e?.dup || e?.register) && (
                        <div className="sp-error" id={`pos-terr-${i}`} role="alert" style={{ marginTop: 6 }}>
                          {e.dup ?? e.account ?? e.amount ?? e.register}
                          {e.register && !e.account && !e.amount && !e.dup && openFor(t.account) === undefined && cashAccounts.some((x) => x.id === t.account) && (
                            <button type="button" className="sp-btn sp-btn--secondary sp-btn--sm" style={{ marginLeft: 8 }} data-testid="pos-open-register-link" onClick={() => { setRegAccount(t.account); setShowRegister(true); }}>
                              Open Register
                            </button>
                          )}
                        </div>
                      )}
                      {!single && (
                        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                          <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm" data-testid="pos-fill-remaining" disabled={remainingUnits === BigInt(0)} onClick={() => fillRemaining(t.key)}>
                            Fill remaining
                          </button>
                          <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm" style={{ color: "var(--danger-500)" }} aria-label={`Remove payment ${i + 1}`} onClick={() => removeTender(t.key)}>
                            <Icon name="trash-2" size={16} />
                            Remove
                          </button>
                        </div>
                      )}
                    </fieldset>
                  );
                })}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <button type="button" className="sp-btn sp-btn--secondary sp-btn--sm" data-testid="pos-add-tender" disabled={tenders.length >= MAX_TENDERS} onClick={addTender}>
                    <Icon name="plus" size={16} />
                    {tenders.length === 1 ? "Split Payment" : "Add Payment"}
                  </button>
                  <div aria-live="polite" data-testid="pos-remaining" style={{ font: "600 14px/20px var(--font-body)", color: remainingUnits === BigInt(0) ? "var(--success-600, #15803d)" : "var(--danger-500)" }}>
                    {remainingUnits === BigInt(0) ? "Fully paid — nothing remaining" : remainingUnits > BigInt(0) ? `Remaining: ${m(fromUnits(remainingUnits, 2))}` : `Over by ${m(fromUnits(-remainingUnits, 2))} — reduce a payment`}
                  </div>
                </div>
              </div>
              <div className="sp-field sp-span-all">
                <label className="sp-label" htmlFor="pos-notes">Notes</label>
                <textarea id="pos-notes" className="sp-textarea" placeholder="Enter Notes" maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
              <div className="sp-field sp-span-all">
                <label className="sp-label">Payment Status</label>
                <input className="sp-input" disabled value="Paid (in full)" readOnly />
              </div>
              {err && (
                <div className="sp-error sp-span-all" role="alert" data-testid="pos-error">
                  {err}
                </div>
              )}
            </div>
            <div className="sp-card" style={{ alignSelf: "start" }}>
              {[
                ["Total Products", String(cart.length)],
                ["Total Amount", m(totals.subtotal)],
                ["Order Tax", m(totals.orderTaxAmount)],
                ["Grand Total", m(totals.grandTotal)],
              ].map(([k, v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "14px 20px", borderBottom: "1px solid var(--border)", font: "400 14px/20px var(--font-body)" }}>
                  <span style={{ color: "var(--text-2)" }}>{k}</span>
                  <span style={k === "Grand Total" ? { fontWeight: 700 } : undefined}>{v}</span>
                </div>
              ))}
            </div>
          </div>
        </Modal>
      )}

      {done && (
        <Modal
          size="sm"
          title="Payment Complete"
          onClose={() => setDone(null)}
          footer={
            <>
              <Link href={`/reports/pos-receipt/${encodeURIComponent(done.saleId)}`} className="sp-btn sp-btn--secondary" data-testid="pos-receipt">
                <Icon name="receipt" size={18} />
                View Receipt
              </Link>
              <button type="button" className="sp-btn sp-btn--primary" onClick={() => { setDone(null); searchRef.current?.focus(); }}>
                New Sale
              </button>
            </>
          }
        >
          <p className="t-body" style={{ margin: 0 }} data-testid="pos-done">
            <Icon name="circle-check" size={18} /> Sale <b>{done.reference}</b> {done.replayed ? "was already completed — nothing was charged again." : "was recorded, paid in full, and stock was deducted. The cart has been cleared."}
          </p>
        </Modal>
      )}
    </div>
  );
}
