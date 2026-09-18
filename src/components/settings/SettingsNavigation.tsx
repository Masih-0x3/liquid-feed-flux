import { useEffect, useRef, type ReactNode } from 'react';

export function SettingsNavigation({ children }: { children: ReactNode }) {
  const navigationRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const navigation = navigationRef.current;
    const scroller = navigation?.closest('main');
    if (!navigation || !scroller) return;
    const previousPadding = scroller.style.scrollPaddingBlockStart;
    const updatePadding = () => {
      scroller.style.scrollPaddingBlockStart = `${Math.ceil(navigation.getBoundingClientRect().height) + 16}px`;
    };
    updatePadding();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updatePadding);
    observer?.observe(navigation);
    window.addEventListener('resize', updatePadding);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updatePadding);
      scroller.style.scrollPaddingBlockStart = previousPadding;
    };
  }, []);

  return <div ref={navigationRef} className="sticky top-0 z-20 space-y-2 rounded-lg border bg-background/95 p-2 backdrop-blur-sm">{children}</div>;
}
