import {
  Activity,
  Download,
  Home,
  Link2,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";

export interface NavigationItem {
  title: string;
  url: string;
  icon: LucideIcon;
}

export const navigationItems: NavigationItem[] = [
  { title: "Dashboard", url: "/", icon: Home },
  { title: "Monitoring", url: "/monitoring", icon: Activity },
  { title: "Threads", url: "/threads", icon: Link2 },
  { title: "My X", url: "/x-account", icon: Users },
  { title: "Downloader", url: "/downloader", icon: Download },
  { title: "Settings", url: "/settings", icon: Settings },
];
