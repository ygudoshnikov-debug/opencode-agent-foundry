import { useEffect, useRef } from 'react';

interface UseKeyboardShortcutsOptions {
  onNavigate?: (page: string) => void;
  onFocusFilter?: () => void;
  onToggleHelp?: () => void;
  onEscape?: () => void;
}

export function useKeyboardShortcuts(options: UseKeyboardShortcutsOptions) {
  const gPressedRef = useRef(false);
  const gTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if focus is on input/textarea (except Escape)
      const target = e.target as HTMLElement;
      const activeElement = document.activeElement as HTMLElement;
      const isInputFocused =
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.contentEditable === 'true') ||
        (activeElement && (
          activeElement.tagName === 'INPUT' ||
          activeElement.tagName === 'TEXTAREA' ||
          activeElement.contentEditable === 'true'
        ));

      if (isInputFocused && e.key !== 'Escape') {
        return;
      }

      // "/" - Focus filter
      if (e.key === '/' && !isInputFocused) {
        e.preventDefault();
        options.onFocusFilter?.();
        return;
      }

      // "?" - Toggle help
      if ((e.key === '?' || (e.shiftKey && e.key === '/')) && !isInputFocused) {
        e.preventDefault();
        options.onToggleHelp?.();
        return;
      }

      // "Escape" - Close panels
      if (e.key === 'Escape') {
        e.preventDefault();
        options.onEscape?.();
        return;
      }

      // "g" - Start navigation sequence
      if (e.key === 'g' && !isInputFocused && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();

        if (!gPressedRef.current) {
          gPressedRef.current = true;

          // Wait for second key
          const handleSecondKey = (e2: KeyboardEvent) => {
            if (gTimeoutRef.current) clearTimeout(gTimeoutRef.current);
            window.removeEventListener('keydown', handleSecondKey);
            gPressedRef.current = false;

            const pageMap: Record<string, string> = {
              d: 'dashboard',
              k: 'kanban',
              g: 'graph',
              t: 'tasks',
              e: 'events',
              s: 'settings',
            };

            if (pageMap[e2.key]) {
              e2.preventDefault();
              options.onNavigate?.(pageMap[e2.key]);
            }
          };

          window.addEventListener('keydown', handleSecondKey);

          // Timeout after 2 seconds
          if (gTimeoutRef.current) clearTimeout(gTimeoutRef.current);
          gTimeoutRef.current = setTimeout(() => {
            window.removeEventListener('keydown', handleSecondKey);
            gPressedRef.current = false;
          }, 2000);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (gTimeoutRef.current) clearTimeout(gTimeoutRef.current);
    };
  }, [options]);
}
