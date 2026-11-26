"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { useT } from "@/components/i18n/I18nProvider";
import Modal from "@/components/ui/Modal";
import { fmt } from "@/lib/i18n/config";
import { previewProductRemoval, removeProductsAction, setProductsStatus, type PreviewResult } from "@/app/(dashboard)/products/remove-actions";

export type RemovalKind = "remove" | "deactivate" | "activate";
type Names = Record<string, { name: string; code: string }>;

// Confirmation for removing / deactivating / activating one or many products. For "remove" the SERVER classifies every product first
// (previewProductRemoval) and this dialog states exactly what will happen: "N products will be permanently deleted" and
// "M products have history and will be deactivated". Nothing is deleted or deactivated before the user confirms, and the server decides
// the outcome again at execution (a product that gained history meanwhile is deactivated, never deleted).
export default function ProductRemovalDialog({ kind, ids, names, canActivate, onClose, onDone }: { kind: RemovalKind; ids: string[]; names: Names; canActivate: boolean; onClose: () => void; onDone: () => void }) {
  const T = useT();
  const S = T.products.status;
  const router = useRouter();
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [pending, startTransition] = useTransition();
  const [loading, setLoading] = useState(kind === "remove");
  const one = ids.length === 1;
  const what = one ? S.whatOne : fmt(S.whatMany, { n: ids.length });

  useEffect(() => {
    if (kind !== "remove") return;
    let alive = true;
    previewProductRemoval(ids)
      .then((r) => alive && setPreview(r))
      .catch(() => alive && setPreview({ ok: false, message: T.common.somethingWrong }))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the preview is requested once per opened dialog
  }, []);

  const title = kind === "remove" ? S.confirmRemoveTitle : kind === "deactivate" ? S.confirmDeactivateTitle : S.confirmActivateTitle;

  const p = preview?.ok ? preview : null;
  // Every selected product is already inactive and has history: removal would change nothing, so no destructive confirmation is offered.
  const nothingToRemove = kind === "remove" && !!p && p.deleteCount === 0 && p.deactivateCount === 0 && p.keepCount > 0;

  function confirm() {
    startTransition(async () => {
      try {
        const r = nothingToRemove
          ? await setProductsStatus(ids, true)
          : kind === "remove"
            ? await removeProductsAction(ids, preview?.ok ? preview.items.filter((i) => i.outcome === "DELETE").map((i) => i.id) : [])
            : await setProductsStatus(ids, kind === "activate");
        if (!r.ok) {
          toast.error(r.message, { id: "products-removal" });
          return;
        }
        toast.success(r.message, { id: "products-removal" });
        onDone();
        router.refresh();
      } catch {
        toast.error(T.common.somethingWrong, { id: "products-removal" });
      }
    });
  }

  const canConfirm = kind !== "remove" || (!!p && (p.deleteCount > 0 || p.deactivateCount > 0 || p.keepCount > 0));
  const reasonText = (r: string[]) => r.map((k) => (S.reasons as Record<string, string>)[k] ?? k).join(", ");

  return (
    <Modal
      title={nothingToRemove ? (one ? S.nothingTitleOne : fmt(S.nothingTitleMany, { n: ids.length })) : fmt(title, { what })}
      onClose={pending ? () => {} : onClose}
      footer={
        <>
          <button type="button" className="sp-btn sp-btn--secondary" onClick={onClose} disabled={pending}>
            {nothingToRemove ? T.common.close : T.common.cancel}
          </button>
          {nothingToRemove ? (
            canActivate && (
              <button type="button" className="sp-btn sp-btn--primary" onClick={confirm} disabled={pending} data-testid="removal-activate">
                {pending ? S.working : S.confirmActivate}
              </button>
            )
          ) : (
            <button type="button" className={"sp-btn " + (kind === "activate" ? "sp-btn--primary" : "sp-btn--danger")} onClick={confirm} disabled={pending || loading || !canConfirm} data-testid="removal-confirm">
              {pending ? S.working : kind === "remove" ? S.confirmRemove : kind === "deactivate" ? S.confirmDeactivate : S.confirmActivate}
            </button>
          )}
        </>
      }
    >
      <div style={{ display: "grid", gap: 12 }} data-testid="removal-dialog">
        {kind === "remove" && loading && <p style={{ margin: 0 }}>{S.checking}</p>}
        {kind === "remove" && preview && !preview.ok && (
          <p className="sp-error" role="alert" style={{ margin: 0 }} data-testid="removal-error">
            {preview.message}
          </p>
        )}
        {p && (
          <>
            {p.deleteCount > 0 && (
              <p style={{ margin: 0, fontWeight: 600 }} data-testid="removal-preview-delete">
                {one ? S.willDeleteOne : fmt(S.willDeleteMany, { n: p.deleteCount })}
              </p>
            )}
            {p.deactivateCount > 0 && (
              <div data-testid="removal-preview-deactivate">
                <p style={{ margin: 0, fontWeight: 600 }}>{one ? S.willDeactivateOne : fmt(S.willDeactivateMany, { n: p.deactivateCount })}</p>
                <ul style={{ margin: "6px 0 0", paddingInlineStart: 20, maxHeight: 160, overflow: "auto" }}>
                  {p.items
                    .filter((i) => i.outcome === "DEACTIVATE")
                    .slice(0, 10)
                    .map((i) => (
                      <li key={i.id}>
                        {names[i.id]?.name ?? i.name} (<bdi dir="ltr">{i.code}</bdi>) — {S.reasonsTitle}
                        {reasonText(i.reasons)}
                      </li>
                    ))}
                </ul>
              </div>
            )}
            {p.keepCount > 0 && (
              <p style={{ margin: 0 }} data-testid="removal-preview-keep">
                {one ? S.willKeepOne : fmt(S.willKeepMany, { n: p.keepCount })}
              </p>
            )}
            {nothingToRemove && canActivate && <p className="t-caption" style={{ margin: 0 }}>{S.activateExplain}</p>}
            {p.deleteCount > 0 && <p className="t-caption" style={{ margin: 0 }}>{S.deleteWarning}</p>}
            {p.deactivateCount > 0 && <p className="t-caption" style={{ margin: 0 }}>{S.deactivateExplain}</p>}
          </>
        )}
        {kind === "deactivate" && <p style={{ margin: 0 }}>{S.deactivateExplain}</p>}
        {kind === "activate" && <p style={{ margin: 0 }}>{S.activateExplain}</p>}
      </div>
    </Modal>
  );
}
