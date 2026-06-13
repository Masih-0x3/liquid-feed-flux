import {
  Activity,
  Download,
  Film,
  Home,
  Link2,
  Settings,
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
  { title: "Video", url: "/video-renders", icon: Film },
  { title: "Threads", url: "/threads", icon: Link2 },
  { title: "Downloader", url: "/downloader", icon: Download },
  { title: "Settings", url: "/settings", icon: Settings },
];
