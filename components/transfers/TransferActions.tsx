"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import Icon from "@/components/layout/Icon";
import { useT } from "@/components/i18n/I18nProvider";
import { fmt } from "@/lib/i18n/config";
import Modal, { ConfirmDeleteModal } from "@/components/ui/Modal";
import { completeTransfer, deleteTransfer, sendTransfer, type TransferResult } from "@/app/(dashboard)/transfers/actions";
import type { TransferStatusValue } from "@/lib/transfers";

// Status actions on the transfer details page (OWNER/ADMIN only; the server re-checks everything).
// PENDING: Edit, Send, Complete, Delete · SENT: Complete · COMPLETED: none (immutable).
type Kind = "send" | "complete" | "delete";

export default function TransferActions({ id, reference, status }: { id: string; reference: string; status: TransferStatusValue }) {
  const router = useRouter();
  const T = useT();
  const A = T.transfers.actions;
  const [open, setOpen] = useState<Kind | null>(null);
  const [pending, startTransition] = useTransition();

  if (status === "COMPLETED") return null;

  function run(kind: Kind) {
    startTransition(async () => {
      let r: TransferResult;
      try {
        r = kind === "send" ? await sendTransfer(id) : kind === "complete" ? await completeTransfer(id) : await deleteTransfer(id);
      } catch {
        toast.error(T.common.somethingWrong, { id: "transfer" });
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

  const completeBody = status === "SENT" ? A.completeBodySent : A.completeBodyPending;

  return (
    <>
      {status === "PENDING" && (
        <>
          <Link href={`/transfers/${encodeURIComponent(id)}/edit`} className="sp-btn sp-btn--secondary">
            <Icon name="pencil" size={18} />
            {A.edit}
          </Link>
          <button type="button" className="sp-btn sp-btn--secondary" style={{ color: "var(--danger-700)" }} onClick={() => setOpen("delete")}>
            <Icon name="trash-2" size={18} />
            {A.delete}
          </button>
          <button type="button" className="sp-btn sp-btn--secondary" onClick={() => setOpen("send")}>
            <Icon name="arrow-right" size={18} />
            {A.markSent}
          </button>
        </>
      )}
      <button type="button" className="sp-btn sp-btn--primary" onClick={() => setOpen("complete")}>
        <Icon name="shield-check" size={18} />
        {A.markCompleted}
      </button>

      {(open === "send" || open === "complete") && (
        <Modal
          title={fmt(open === "send" ? A.sendTitle : A.completeTitle, { ref: reference })}
          onClose={() => !pending && setOpen(null)}
          footer={
            <>
              <button type="button" className="sp-btn sp-btn--secondary" onClick={() => setOpen(null)} disabled={pending}>
                {A.cancel}
              </button>
              <button type="button" className="sp-btn sp-btn--primary" onClick={() => run(open)} disabled={pending}>
                {pending ? T.common.saving : open === "send" ? A.send : A.complete}
              </button>
            </>
          }
        >
          <p className="t-body" style={{ margin: 0, color: "var(--text-2)" }}>
            {open === "send" ? A.sendBody : completeBody}
          </p>
        </Modal>
      )}
      {open === "delete" && <ConfirmDeleteModal itemType={T.transfers.list.deleteType} itemName={reference} busy={pending} onCancel={() => setOpen(null)} onConfirm={() => run("delete")} />}
    </>
  );
}
