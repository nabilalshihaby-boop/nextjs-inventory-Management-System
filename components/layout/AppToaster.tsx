"use client";

import { Toaster } from "react-hot-toast";

// One toast outlet for the whole dashboard shell (react-hot-toast), styled with design tokens.
export default function AppToaster() {
  return (
    <Toaster
      position="top-right"
      toastOptions={{
        duration: 4000,
        style: {
          font: "500 14px/20px var(--font-body)",
          color: "var(--text-1)",
          background: "var(--bg-surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-md)",
          boxShadow: "var(--shadow-lg)",
        },
      }}
    />
  );
}
