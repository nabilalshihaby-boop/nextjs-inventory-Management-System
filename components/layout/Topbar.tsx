import Link from "next/link";
import { Suspense } from "react";
import Icon from "./Icon";
import { FullscreenButton, MenuButton, PageTitle, SearchBox } from "./TopbarControls";
import UserMenu, { type TopbarUser } from "./UserMenu";

// Server component: static structure + links. Interactive pieces come from TopbarControls and
// UserMenu (client). `user` is the signed-in user, passed down from the dashboard layout.
export default function Topbar({ user }: { user: TopbarUser }) {
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
        <UserMenu user={user} />
      </div>
    </header>
  );
}
