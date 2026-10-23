import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ZoomContainer } from './ZoomContainer';
import { describe, it, expect, vi } from 'vitest';

describe('ZoomContainer', () => {
  const layoutId = 'test-zoom';
  const content = <div data-testid="content">Test Content</div>;

  it('stays in place when not expanded', () => {
    render(
      <ZoomContainer isExpanded={false} layoutId={layoutId}>
        {content}
      </ZoomContainer>
    );

    const root = screen.getByTestId('content').closest('.zoom-root')!;
    expect(root).toHaveClass('is-inline');
    expect(root).toHaveAttribute('data-zoom', 'inline');
    expect(root.querySelector('.zoom-scrim')).toBeNull();
  });

  it('fills the viewport and offers an ascent target when expanded', () => {
    render(
      <ZoomContainer isExpanded layoutId={layoutId}>
        {content}
      </ZoomContainer>
    );

    const root = screen.getByTestId('content').closest('.zoom-root')!;
    expect(root).toHaveClass('is-expanded');
    expect(root).toHaveAttribute('data-zoom', 'expanded');
    expect(root.querySelector('.zoom-scrim')).toBeInTheDocument();
  });

  it('caps the dive width through the token, not a hardcoded utility', () => {
    render(
      <ZoomContainer isExpanded layoutId={layoutId} maxWidth="900px">
        {content}
      </ZoomContainer>
    );

    const root = screen.getByTestId('content').closest('.zoom-root') as HTMLElement;
    const body = screen.getByTestId('content').parentElement!;
    expect(body).toHaveClass('zoom-body');
    expect(root.style.getPropertyValue('--zoom-w')).toBe('900px');
    expect(body.className).not.toMatch(/\bmax-w-/);
  });

  it('ascends on a scrim click but not before it is expanded', () => {
    const onDismiss = vi.fn();
    const { rerender } = render(
      <ZoomContainer isExpanded={false} layoutId={layoutId} onDismiss={onDismiss}>
        {content}
      </ZoomContainer>
    );

    expect(screen.queryByRole('button', { hidden: true })).toBeNull();

    rerender(
      <ZoomContainer isExpanded layoutId={layoutId} onDismiss={onDismiss}>
        {content}
      </ZoomContainer>
    );

    fireEvent.click(document.querySelector('.zoom-scrim')!);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
