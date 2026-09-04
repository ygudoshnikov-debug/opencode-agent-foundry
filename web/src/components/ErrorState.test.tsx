import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ErrorState from './ErrorState';

describe('ErrorState', () => {
  it('should render error message', () => {
    render(<ErrorState error="Test error message" />);
    expect(screen.getByText('Test error message')).toBeInTheDocument();
  });

  it('should render error title', () => {
    render(<ErrorState error="Test error" />);
    expect(screen.getByText('Error')).toBeInTheDocument();
  });

  it('should render dismiss button if onDismiss is provided', () => {
    const onDismiss = vi.fn();
    render(<ErrorState error="Test error" onDismiss={onDismiss} />);
    const dismissButton = screen.getByLabelText('Dismiss error');
    expect(dismissButton).toBeInTheDocument();
  });

  it('should not render dismiss button if onDismiss is not provided', () => {
    render(<ErrorState error="Test error" />);
    const dismissButton = screen.queryByLabelText('Dismiss error');
    expect(dismissButton).not.toBeInTheDocument();
  });

  it('should call onDismiss when dismiss button is clicked', () => {
    const onDismiss = vi.fn();
    const { rerender } = render(<ErrorState error="Test error" onDismiss={onDismiss} />);
    const dismissButton = screen.getByLabelText('Dismiss error');
    dismissButton.click();
    expect(onDismiss).toHaveBeenCalled();
  });
});
