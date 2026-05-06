'use client';

import { useEffect } from 'react';
import { useTheme } from 'next-themes';

export function ThemeSync() {
  const { setTheme } = useTheme();
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'SET_THEME' && (e.data.theme === 'dark' || e.data.theme === 'light')) {
        setTheme(e.data.theme);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [setTheme]);
  return null;
}
