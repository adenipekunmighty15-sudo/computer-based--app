import React from 'react';
import { ZoomContainer } from '../primitives/ZoomContainer';
import { useHotkeys } from '../../lib/hooks';

interface FocusQuestionProps {
  id: string;
  isExpanded: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

/**
 * FocusQuestion implements the Focus-Zoom "Dive" pattern.
 *
 * The question stays mounted in both states: diving in lifts the same stem and
 * options into a centred glass surface rather than replacing them with a
 * summary, so a student can answer while zoomed and never loses their place.
 * The surface keeps the paper register because the content inside it is set in
 * graphite — the dimmed page behind is what recedes, not the question.
 */
export const FocusQuestion: React.FC<FocusQuestionProps> = ({ id, isExpanded, onClose, children }) => {
  useHotkeys([{ keys: 'escape', handler: onClose, allowInInput: true }], isExpanded)

  return (
    <ZoomContainer
      layoutId={`focus-question-${id}`}
      isExpanded={isExpanded}
      onDismiss={onClose}
      maxWidth="780px"
    >
      <div className="focus-stage" data-open={isExpanded ? '' : undefined}>
        <button type="button" className="focus-x" onClick={onClose} aria-label="Close focused question">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        <div className="focus-scroll">{children}</div>
      </div>
    </ZoomContainer>
  );
};
