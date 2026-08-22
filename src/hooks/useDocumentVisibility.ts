import { useEffect, useState } from 'react';

function currentDocumentVisibility(): boolean {
  return typeof document !== 'undefined' && document.visibilityState !== 'hidden';
}

export function useDocumentVisibility(): boolean {
  const [isVisible, setIsVisible] = useState(currentDocumentVisibility);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const updateVisibility = () => setIsVisible(currentDocumentVisibility());
    updateVisibility();
    document.addEventListener('visibilitychange', updateVisibility);
    return () => document.removeEventListener('visibilitychange', updateVisibility);
  }, []);

  return isVisible;
}
