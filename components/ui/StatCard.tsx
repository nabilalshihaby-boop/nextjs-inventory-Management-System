import Icon, { type IconName } from "@/components/layout/Icon";

export type StatTone = "teal" | "green" | "blue" | "amber" | "violet" | "rose" | "cyan" | "red";

/** Design StatCard (.sp-stat): coloured KPI tile with icon, value, label and optional note. */
export default function StatCard({ tone, icon, value, label, note, testId }: { tone: StatTone; icon: IconName; value: string; label: string; note?: string; testId?: string }) {
  return (
    <div className={`sp-stat sp-stat--${tone}`} data-testid={testId}>
      <div className="sp-stat-icon">
        <Icon name={icon} size={28} />
      </div>
      <div className="sp-stat-body">
        <div className="sp-stat-value">{value}</div>
        <div className="sp-stat-label">{label}</div>
        {note && <div className="sp-stat-note">{note}</div>}
      </div>
    </div>
  );
}
