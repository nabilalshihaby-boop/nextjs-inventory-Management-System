import Link from "next/link";
import { Suspense } from "react";
import Icon from "./Icon";
import { FullscreenButton, MenuButton, PageTitle, SearchBox, UserMenu } from "./TopbarControls";

// Server component: static structure + links. Interactive pieces come from TopbarControls (client).
export default function Topbar({
  userName = "admin",
  userRole = "Administrator",
}: {
  userName?: string;
  userRole?: string;
}) {
  return (
    <header className="bp-topbar">
      <MenuButton />
      <Suspense fallback={<span className="sp-crumb" />}>
        <PageTitle />
      </Suspense>
      <SearchBox />
      <div className="sp-topbar-r">
        <Link href="/pos" className="sp-btn sp-btn--accent">
          <Icon name="monitor-smartphone" size={18} />
          POS
        </Link>
        <FullscreenButton />
        <Link href="/products" className="sp-btn sp-btn--ghost sp-btn--icon" aria-label="Low stock alerts">
          <Icon name="bell" size={18} />
        </Link>
        <UserMenu userName={userName} userRole={userRole} />
      </div>
    </header>
  );
}
