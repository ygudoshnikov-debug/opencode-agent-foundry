import { useEffect, useState } from 'react';
import { Monitor, Sun, Moon, HelpCircle, Circle } from 'lucide-react';
import type { ConnectionStatus } from '@/hooks';
import { useFoundryStore } from '@/stores/foundry';

/**
 * The app header strip.
 *
 * The window keeps its native OS decorations, so this bar deliberately does NOT
 * repeat the application name or draw its own minimise/maximise/close buttons —
 * a second set of window controls that do not control the window is worse than
 * none. The strip carries what the title bar cannot: the objective being worked
 * on, live connection state, and the two controls people reach for most.
 */

type Theme = 'light' | 'dark' | 'system';

const THEME_KEY = 'foundry.theme';
const THEME_ORDER: Theme[] = ['system', 'light', 'dark'];
const THEME_LABEL: Record<Theme, string> = { system: 'System', light: 'Light', dark: 'Dark' };

function readStoredTheme(): Theme {
  try {
    const value = localStorage.getItem(THEME_KEY);
    if (value === 'light' || value === 'dark' || value === 'system') return value;
  } catch {
    // Private mode, or storage blocked. The default is fine.
  }
  return 'system';
}

function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Not being able to remember the choice must not break switching it.
  }
}

interface TitleBarProps {
  status?: ConnectionStatus;
  onShowShortcuts?: () => void;
}

export default function TitleBar({ status = 'connected', onShowShortcuts }: TitleBarProps) {
  const [theme, setTheme] = useState<Theme>(readStoredTheme);
  const { state } = useFoundryStore();

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const cycleTheme = (): void => {
    setTheme((current) => THEME_ORDER[(THEME_ORDER.indexOf(current) + 1) % THEME_ORDER.length]!);
  };

  const objective = state.project?.objective;
  const statusColor = status === 'connected' ? 'success' : status === 'connecting' || status === 'reconnecting' ? 'warning' : 'error';

  const themeIcon = theme === 'system' ? Monitor : theme === 'light' ? Sun : Moon;
  const ThemeIcon = themeIcon;

  return (
    <div className="navbar bg-base-100 shadow-sm border-b border-base-300 px-4 h-16">
      <div className="flex-1">
        <div className="flex items-center gap-3">
          <div className={`status status-${statusColor} status-sm`} title={`Bridge ${status}`} />
          <div className="truncate">
            <span className="text-sm text-base-content/70 block truncate" title={objective ?? undefined}>
              {objective ?? 'No project in this directory yet'}
            </span>
          </div>
        </div>
      </div>

      <div className="flex-none flex gap-2">
        <button
          type="button"
          className="btn btn-ghost btn-sm btn-square"
          onClick={cycleTheme}
          title={`Theme: ${THEME_LABEL[theme]} — click to change`}
          aria-label={`Theme: ${THEME_LABEL[theme]}. Click to change.`}
        >
          <ThemeIcon className="w-5 h-5" />
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm btn-square"
          onClick={onShowShortcuts}
          title="Keyboard shortcuts (?)"
          aria-label="Show keyboard shortcuts"
        >
          <HelpCircle className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}
