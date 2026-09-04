import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';

describe('useKeyboardShortcuts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should navigate on "g" followed by page key', () => {
    const onNavigate = vi.fn();
    renderHook(() => useKeyboardShortcuts({ onNavigate }));

    // Press "g"
    const gEvent = new KeyboardEvent('keydown', { key: 'g' });
    window.dispatchEvent(gEvent);

    // Press "d" for dashboard
    const dEvent = new KeyboardEvent('keydown', { key: 'd' });
    window.dispatchEvent(dEvent);

    expect(onNavigate).toHaveBeenCalledWith('dashboard');
  });

  it('should focus filter on "/"', () => {
    const onFocusFilter = vi.fn();
    renderHook(() => useKeyboardShortcuts({ onFocusFilter }));

    const event = new KeyboardEvent('keydown', { key: '/' });
    window.dispatchEvent(event);

    expect(onFocusFilter).toHaveBeenCalled();
  });

  it('should toggle help on "?"', () => {
    const onToggleHelp = vi.fn();
    renderHook(() => useKeyboardShortcuts({ onToggleHelp }));

    const event = new KeyboardEvent('keydown', { key: '?', shiftKey: true });
    window.dispatchEvent(event);

    expect(onToggleHelp).toHaveBeenCalled();
  });

  it('should close panel on Escape', () => {
    const onEscape = vi.fn();
    renderHook(() => useKeyboardShortcuts({ onEscape }));

    const event = new KeyboardEvent('keydown', { key: 'Escape' });
    window.dispatchEvent(event);

    expect(onEscape).toHaveBeenCalled();
  });

  it('should ignore shortcuts when input is focused', () => {
    const onFocusFilter = vi.fn();
    const onNavigate = vi.fn();
    renderHook(() => useKeyboardShortcuts({ onFocusFilter, onNavigate }));

    // Create a focused input
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    // Clear mock call count
    onFocusFilter.mockClear();
    onNavigate.mockClear();

    // Try to trigger shortcuts while input is focused
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '/' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'g' }));

    expect(onFocusFilter).not.toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();

    document.body.removeChild(input);
  });

  it('should allow Escape even when input is focused', () => {
    const onEscape = vi.fn();
    renderHook(() => useKeyboardShortcuts({ onEscape }));

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(onEscape).toHaveBeenCalled();

    document.body.removeChild(input);
  });

  it('should navigate on all valid page keys after g', () => {
    const onNavigate = vi.fn();
    renderHook(() => useKeyboardShortcuts({ onNavigate }));

    const pageKeys = [
      { key: 'd', page: 'dashboard' },
      { key: 'k', page: 'kanban' },
      { key: 'g', page: 'graph' },
      { key: 't', page: 'tasks' },
      { key: 'e', page: 'events' },
      { key: 's', page: 'settings' },
    ];

    pageKeys.forEach(({ key, page }) => {
      onNavigate.mockClear();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'g' }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key }));
      expect(onNavigate).toHaveBeenCalledWith(page);
    });
  });
});
