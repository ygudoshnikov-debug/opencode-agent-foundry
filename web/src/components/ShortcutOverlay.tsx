interface Shortcut {
  keys: string;
  description: string;
  category?: string;
}

interface ShortcutOverlayProps {
  visible: boolean;
  onClose: () => void;
}

const SHORTCUTS: Shortcut[] = [
  { keys: 'g', category: 'Navigation', description: 'Open navigation (then press d/k/g/t/e/s)' },
  { keys: 'g d', description: 'Go to Dashboard' },
  { keys: 'g k', description: 'Go to Kanban' },
  { keys: 'g g', description: 'Go to Graph' },
  { keys: 'g t', description: 'Go to Tasks' },
  { keys: 'g e', description: 'Go to Events' },
  { keys: 'g s', description: 'Go to Settings' },
  { keys: '/', category: 'Search', description: 'Focus filter/search input' },
  { keys: '?', category: 'Help', description: 'Toggle this shortcuts overlay' },
  { keys: 'Esc', description: 'Close panels and overlays' },
];

export default function ShortcutOverlay({ visible, onClose }: ShortcutOverlayProps) {
  const groupedShortcuts = SHORTCUTS.reduce(
    (acc, shortcut) => {
      const category = shortcut.category || 'General';
      if (!acc[category]) acc[category] = [];
      acc[category].push(shortcut);
      return acc;
    },
    {} as Record<string, Shortcut[]>,
  );

  return (
    <dialog className="modal" open={visible}>
      <div className="modal-box w-full max-w-2xl">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold">Keyboard Shortcuts</h2>
          <button
            className="btn btn-sm btn-circle btn-ghost"
            onClick={onClose}
            aria-label="Close shortcuts"
          >
            ✕
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-h-96 overflow-y-auto">
          {Object.entries(groupedShortcuts).map(([category, shortcuts]) => (
            <div key={category}>
              <h3 className="font-semibold text-base-content mb-3 text-sm uppercase tracking-wider">
                {category}
              </h3>
              <div className="space-y-2">
                {shortcuts.map((shortcut) => (
                  <div key={shortcut.keys} className="flex items-start gap-3">
                    <kbd className="kbd kbd-xs flex-shrink-0">{shortcut.keys}</kbd>
                    <span className="text-sm text-base-content/70">{shortcut.description}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 text-xs text-base-content/50 text-center">
          Press ? to toggle, or click outside to close
        </div>
      </div>
      <form method="dialog" className="modal-backdrop">
        <button onClick={onClose}>close</button>
      </form>
    </dialog>
  );
}
