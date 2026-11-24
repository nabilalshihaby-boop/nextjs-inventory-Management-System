import Link from "next/link";
import { Suspense } from "react";
import Icon from "./Icon";
import { FullscreenButton, MenuButton, PageTitle, SearchBox } from "./TopbarControls";
import UserMenu, { type TopbarUser } from "./UserMenu";
import { getDict } from "@/lib/i18n/server";

// Server component: static structure + links. Interactive pieces come from TopbarControls and
// UserMenu (client). `user` is the signed-in user, passed down from the dashboard layout.
export default async function Topbar({ user, showPos = true, showProducts = true }: { user: TopbarUser; showPos?: boolean; showProducts?: boolean }) {
  const t = await getDict();
  return (
    <header className="bp-topbar">
      <MenuButton />
      <Suspense fallback={<span className="sp-crumb" />}>
        <PageTitle />
      </Suspense>
      {showProducts ? <SearchBox /> : <span style={{ flex: 1 }} />}
      <div className="sp-topbar-r">
        {showPos && (
          <Link href="/pos" className="sp-btn sp-btn--accent">
            <Icon name="monitor-smartphone" size={18} />
            {t.shell.pos}
          </Link>
        )}
        <FullscreenButton />
        {showProducts && (
          <Link href="/products" className="sp-btn sp-btn--ghost sp-btn--icon" aria-label={t.shell.lowStock}>
            <Icon name="bell" size={18} />
          </Link>
        )}
        <UserMenu user={user} />
      </div>
    </header>
  );
}
