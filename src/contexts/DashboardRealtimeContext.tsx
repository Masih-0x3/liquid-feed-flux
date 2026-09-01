import { createContext, useContext, type ReactNode } from 'react';

export type DashboardRealtimeHandler = () => void;
export type DashboardRealtimeSubscriptions = {
  subscribeDashboardPosts: (onInvalidate: DashboardRealtimeHandler) => () => void;
  subscribeDashboardProcessHud: (onInvalidate: DashboardRealtimeHandler) => () => void;
};

const DashboardRealtimeContext = createContext<DashboardRealtimeSubscriptions | null>(null);

export function DashboardRealtimeProvider({
  subscriptions,
  children,
}: {
  subscriptions: DashboardRealtimeSubscriptions;
  children: ReactNode;
}) {
  return (
    <DashboardRealtimeContext.Provider value={subscriptions}>
      {children}
    </DashboardRealtimeContext.Provider>
  );
}

export function useDashboardRealtime() {
  return useContext(DashboardRealtimeContext);
}
