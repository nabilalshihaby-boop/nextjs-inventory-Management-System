import type { CSSProperties } from "react";
import {
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  Banknote,
  Bell,
  ChartColumn,
  ChevronDown,
  CircleAlert,
  CircleDollarSign,
  CircleMinus,
  DollarSign,
  Eye,
  EyeOff,
  File,
  FileText,
  HandCoins,
  Info,
  KeyRound,
  Landmark,
  Languages,
  LayoutDashboard,
  Lock,
  LogOut,
  Mail,
  Maximize,
  Menu,
  MonitorSmartphone,
  Package,
  PackagePlus,
  PanelLeftClose,
  PanelLeftOpen,
  Receipt,
  Search,
  Settings,
  ShieldCheck,
  ShoppingCart,
  SlidersHorizontal,
  User,
  Users,
  Wallet,
  Warehouse,
  type LucideIcon,
} from "lucide-react";

// Lucide icons by their kebab-case name (the names used in /design), imported explicitly so
// only these are bundled. Add an entry here when a page needs a new icon.
const ICONS = {
  "arrow-left": ArrowLeft,
  "arrow-left-right": ArrowLeftRight,
  "arrow-right": ArrowRight,
  banknote: Banknote,
  bell: Bell,
  "chart-column": ChartColumn,
  "chevron-down": ChevronDown,
  "circle-alert": CircleAlert,
  "circle-dollar-sign": CircleDollarSign,
  "circle-minus": CircleMinus,
  "dollar-sign": DollarSign,
  eye: Eye,
  "eye-off": EyeOff,
  file: File,
  "file-text": FileText,
  "hand-coins": HandCoins,
  info: Info,
  "key-round": KeyRound,
  landmark: Landmark,
  languages: Languages,
  "layout-dashboard": LayoutDashboard,
  lock: Lock,
  "log-out": LogOut,
  mail: Mail,
  maximize: Maximize,
  menu: Menu,
  "monitor-smartphone": MonitorSmartphone,
  package: Package,
  "package-plus": PackagePlus,
  "panel-left-close": PanelLeftClose,
  "panel-left-open": PanelLeftOpen,
  receipt: Receipt,
  search: Search,
  settings: Settings,
  "shield-check": ShieldCheck,
  "shopping-cart": ShoppingCart,
  "sliders-horizontal": SlidersHorizontal,
  user: User,
  users: Users,
  wallet: Wallet,
  warehouse: Warehouse,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

// Decorative by default (aria-hidden), like the design's Icon: buttons carry the aria-label.
// Stroke is currentColor with Lucide's default 2px stroke, matching the design's mask icons.
export default function Icon({
  name,
  size = 18,
  className = "",
  style,
}: {
  name: IconName;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const Svg = ICONS[name];
  return <Svg aria-hidden="true" size={size} className={`sp-icon ${className}`.trim()} style={style} />;
}
