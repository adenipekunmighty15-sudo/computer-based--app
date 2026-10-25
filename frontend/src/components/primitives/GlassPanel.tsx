import React from 'react';

interface GlassPanelProps {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * The glass surface every exploded Focus-Zoom state lands in. Blur, fill, and
 * border all come from tokens so a "solid surface" preference drops the
 * translucency without this component knowing about it.
 */
export const GlassPanel: React.FC<GlassPanelProps> = ({ children, className = '', style }) => {
  return (
    <div className={`glass-panel ${className}`.trim()} style={style}>
      {children}
    </div>
  );
};
