import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, it, expect } from 'vitest';
import { GlassPanel } from './GlassPanel';

describe('GlassPanel', () => {
  it('renders children correctly', () => {
    render(
      <GlassPanel>
        <div data-testid="child">Hello Glass</div>
      </GlassPanel>
    );

    expect(screen.getByTestId('child')).toBeInTheDocument();
    expect(screen.getByText('Hello Glass')).toBeInTheDocument();
  });

  it('carries the glass surface class rather than uncompiled utilities', () => {
    const { container } = render(<GlassPanel>Content</GlassPanel>);

    const panel = container.firstChild as HTMLElement;
    expect(panel).toHaveClass('glass-panel');
    expect(panel.className).not.toMatch(/\bbg-\[|rounded-lg|backdrop-blur-/);
  });

  it('keeps caller classes and forwards inline styles', () => {
    const { container } = render(
      <GlassPanel className="bank-editor" style={{ opacity: 0.5 }}>
        Content
      </GlassPanel>
    );

    const panel = container.firstChild as HTMLElement;
    expect(panel).toHaveClass('glass-panel');
    expect(panel).toHaveClass('bank-editor');
    expect(panel.style.opacity).toBe('0.5');
  });
});
