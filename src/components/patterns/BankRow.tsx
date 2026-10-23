import React, { useState } from 'react';
import type { Question } from '../../api';
import { ZoomContainer } from '../primitives/ZoomContainer';
import { GlassPanel } from '../primitives/GlassPanel';
import { QuestionEditor } from './QuestionEditor';
import { useHotkeys } from '../../lib/hooks';

interface BankRowProps {
  question: Question;
  number: number;
  tags: string[];
  saving: boolean;
  onSave: (q: Question) => Promise<boolean> | boolean;
}

/**
 * BankRow implements the "Dive" pattern: a dense row in the list that springs
 * into a full-height editor. The row is a real button so it is reachable by
 * keyboard, Escape always ascends, and the dive only closes on a save that
 * actually landed — a failed edit stays open with the draft intact.
 */
export const BankRow: React.FC<BankRowProps> = React.memo(({ question, number, tags, saving, onSave }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const close = () => setIsExpanded(false);

  useHotkeys([{ keys: 'escape', handler: close, allowInInput: true }], isExpanded);

  const id = String(question.id ?? number);

  return (
    <ZoomContainer layoutId={`bank-row-${id}`} isExpanded={isExpanded} onDismiss={close} maxWidth="900px">
      {/* Dense row — the in-place reading state. */}
      {!isExpanded && (
        <button type="button" className="bank-row" onClick={() => setIsExpanded(true)}>
          <span className="bank-num">{number}.</span>
          <span className="bank-text">{question.prompt}</span>
          <span className="bank-tags">
            {tags.map(tag => (
              <span key={tag} className="tag neutral">
                {tag}
              </span>
            ))}
          </span>
        </button>
      )}

      {/* Exploded — the same row's content, expanded onto a working surface. */}
      {isExpanded && (
        <GlassPanel className="bank-editor">
          <div className="bank-editor-head">
            <div className="panel-head-actions">
              <span className="bank-editor-label">Question {number}</span>
              {tags.map(tag => (
                <span key={tag} className="tag neutral">
                  {tag}
                </span>
              ))}
            </div>
            <button type="button" className="btn quiet sm" onClick={close}>
              Close
            </button>
          </div>

          <div className="bank-editor-body">
            <QuestionEditor
              key={id}
              q={question}
              saving={saving}
              submitLabel="Save question"
              footer="pinned"
              onSave={async (next) => {
                const stored = await onSave(next);
                if (stored) close();
                return stored;
              }}
              onCancel={close}
            />
          </div>
        </GlassPanel>
      )}
    </ZoomContainer>
  );
});

BankRow.displayName = 'BankRow';
