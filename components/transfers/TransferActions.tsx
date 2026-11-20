"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import Icon from "@/components/layout/Icon";
import Modal, { ConfirmDeleteModal } from "@/components/ui/Modal";
import { completeTransfer, deleteTransfer, sendTransfer, type TransferResult } from "@/app/(dashboard)/transfers/actions";
import type { TransferStatusValue } from "@/lib/transfers";

// Status actions on the transfer details page (OWNER/ADMIN only; the server re-checks everything).
// PENDING: Edit, Send, Complete, Delete · SENT: Complete · COMPLETED: none (immutable).
type Kind = "send" | "complete" | "delete";

const SEND_BODY = "The quantities will be deducted from the source warehouse now. A sent transfer can no longer be edited or deleted.";

export default function TransferActions({ id, reference, status }: { id: string; reference: string; status: TransferStatusValue }) {
  const router = useRouter();
  const [open, setOpen] = useState<Kind | null>(null);
  const [pending, startTransition] = useTransition();

  if (status === "COMPLETED") return null;

  function run(kind: Kind) {
    startTransition(async () => {
      let r: TransferResult;
      try {
        r = kind === "send" ? await sendTransfer(id) : kind === "complete" ? await completeTransfer(id) : await deleteTransfer(id);
      } catch {
        toast.error("Something went wrong. Please try again.", { id: "transfer" });
        return;
      }
      setOpen(null);
      if (!r.ok) {
        toast.error(r.message, { id: "transfer" });
        router.refresh();
        return;
      }
      toast.success(r.message, { id: "transfer" });
      if (kind === "delete") router.push("/transfers");
      router.refresh();
    });
  }

  const completeBody =
    status === "SENT"
      ? "The quantities will be added to the destination warehouse (they were already deducted from the source when sent). Completed transfers can't be changed."
      : "The quantities will be deducted from the source warehouse and added to the destination now. Completed transfers can't be changed.";

  return (
    <>
      {status === "PENDING" && (
        <>
          <Link href={`/transfers/${encodeURIComponent(id)}/edit`} className="sp-btn sp-btn--secondary">
            <Icon name="pencil" size={18} />
            Edit
          </Link>
          <button type="button" className="sp-btn sp-btn--secondary" style={{ color: "var(--danger-700)" }} onClick={() => setOpen("delete")}>
            <Icon name="trash-2" size={18} />
            Delete
          </button>
          <button type="button" className="sp-btn sp-btn--secondary" onClick={() => setOpen("send")}>
            <Icon name="arrow-right" size={18} />
            Mark as Sent
          </button>
        </>
      )}
      <button type="button" className="sp-btn sp-btn--primary" onClick={() => setOpen("complete")}>
        <Icon name="shield-check" size={18} />
        Mark as Completed
      </button>

      {(open === "send" || open === "complete") && (
        <Modal
          title={open === "send" ? `Send ${reference}?` : `Complete ${reference}?`}
          onClose={() => !pending && setOpen(null)}
          footer={
            <>
              <button type="button" className="sp-btn sp-btn--secondary" onClick={() => setOpen(null)} disabled={pending}>
                Cancel
              </button>
              <button type="button" className="sp-btn sp-btn--primary" onClick={() => run(open)} disabled={pending}>
                {pending ? "Saving…" : open === "send" ? "Send" : "Complete"}
              </button>
            </>
          }
        >
          <p className="t-body" style={{ margin: 0, color: "var(--text-2)" }}>
            {open === "send" ? SEND_BODY : completeBody}
          </p>
        </Modal>
      )}
      {open === "delete" && <ConfirmDeleteModal itemType="transfer" itemName={reference} busy={pending} onCancel={() => setOpen(null)} onConfirm={() => run("delete")} />}
    </>
  );
}
