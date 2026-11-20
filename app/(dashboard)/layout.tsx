import AppShell from "@/components/layout/AppShell";
import Sidebar from "@/components/layout/Sidebar";
import Topbar from "@/components/layout/Topbar";
import Footer from "@/components/layout/Footer";

// Shared dashboard shell (server component). Pages under app/(dashboard)/ render only their own content.
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell>
      <Sidebar />
      <div className="bp-main">
        <Topbar userName="admin" userRole="Administrator" />
        <main className="bp-content">{children}</main>
        <Footer />
      </div>
    </AppShell>
  );
}
