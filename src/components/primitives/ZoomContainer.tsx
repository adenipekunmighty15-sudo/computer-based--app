import React from 'react';
import { motion, type HTMLMotionProps } from 'framer-motion';
import { SPRING_CONFIG } from '../../styles/animations';

interface ZoomContainerProps extends Omit<HTMLMotionProps<'div'>, 'style'> {
  isExpanded: boolean;
  layoutId: string;
  children: React.ReactNode;
  /** Fired when the reader clicks the receded backdrop — the ascent gesture. */
  onDismiss?: () => void;
  /** Caps the exploded width. The surface should never span the whole viewport. */
  maxWidth?: string;
  style?: React.CSSProperties;
}

/**
 * ZoomContainer provides the core "Dive and Ascent" motion.
 * In place it is an ordinary relative wrapper that is fully interactive.
 * Exploded it becomes a fixed, centred, click-through frame whose backdrop
 * catches the ascent click, and its body springs from the dense box to the
 * middle of the screen via the shared layoutId.
 */
export const ZoomContainer: React.FC<ZoomContainerProps> = ({
  isExpanded,
  layoutId,
  children,
  onDismiss,
  maxWidth,
  className,
  style,
  ...props
}) => {
  return (
    <motion.div
      transition={SPRING_CONFIG}
      data-zoom={isExpanded ? 'expanded' : 'inline'}
      className={`zoom-root ${isExpanded ? 'is-expanded' : 'is-inline'} ${className || ''}`.trim()}
      style={{ ...(maxWidth ? ({ '--zoom-w': maxWidth } as React.CSSProperties) : null), ...style }}
      {...props}
    >
      {isExpanded && (
        <button type="button" className="zoom-scrim" onClick={onDismiss} tabIndex={-1} aria-hidden="true" />
      )}

      <motion.div layoutId={layoutId} transition={SPRING_CONFIG} className="zoom-body">
        {children}
      </motion.div>
    </motion.div>
  );
};
