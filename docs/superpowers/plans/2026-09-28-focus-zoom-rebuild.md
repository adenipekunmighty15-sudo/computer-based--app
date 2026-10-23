# Focus-Zoom UI/UX Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the CBT app into a fluid "Focus-Zoom" immersive experience using a governed design system.

**Architecture:** A three-layer system (Tokens $\rightarrow$ Primitives $\rightarrow$ Patterns) using Framer Motion for shared element transitions to create "Dive and Ascent" effects.

**Tech Stack:** React, Tailwind CSS, Framer Motion.

**Spec:** `docs/superpowers/specs/2026-09-28-ui-ux-rebuild-design.md`

## Global Constraints
- Zero hardcoded raw hex/px values outside `tokens.css`.
- All motion must use the agreed `cubic-bezier` spring curves.
- Components must survive adversarial content (long text/large images) without layout breakage.
- Performance must maintain 60fps during "Explode" transitions.

## Review Focus
- **Extremely long questions:** Ensure "exploded" views scroll internally and don't push the "Close" button off-screen.
- **Rapid-fire clicks:** Ensure the "Ascent" completes or cancels gracefully if the user clicks "Explode" on multiple items quickly.
- **Contrast:** Verify that Glassmorphism blur doesn't make text unreadable on light/dark backgrounds.
- **Z-Index collisions:** Ensure the "Zoomed" card always stays above the Blurred Backdrop.
- **Image Scaling:** Verify that large images in a ZoomCard use `object-fit: contain` and don't distort the card aspect ratio.

---

## Phase 1: Token & Motion Foundation

### Task 1: Global Design Tokens
**Files:**
- Create: `src/styles/tokens.css`
- Modify: `src/index.css` (to import tokens)

**Interfaces:**
- Produces: CSS Variables (e.g., `--c-primary`, `--s-4`, `--dur-spring`)

- [ ] **Step 1: Define Token set**
```css
:root {
  --c-primary: #2DD4BF;
  --c-surface: #161A22;
  --c-glass: rgba(255, 255, 255, 0.1);
  --s-4: 16px;
  --dur-spring: cubic-bezier(0.175, 0.885, 0.32, 1.275);
  --dur-fast: 200ms;
}
```
- [ ] **Step 2: Import into global CSS**
- [ ] **Step 3: Commit**

### Task 2: Framer Motion Presets
**Files:**
- Create: `src/styles/animations.ts`

**Interfaces:**
- Produces: `SPRING_CONFIG` object for use in all components.

- [ ] **Step 1: Define spring constants**
```typescript
export const SPRING_CONFIG = {
  stiffness: 300,
  damping: 20,
  mass: 1,
};
```
- [ ] **Step 2: Commit**

---

## Phase 2: The Primitives

### Task 3: The GlassPanel Primitive
**Files:**
- Create: `src/components/primitives/GlassPanel.tsx`
- Test: `src/components/primitives/GlassPanel.test.tsx`

**Interfaces:**
- Consumes: `tokens.css`
- Produces: `<GlassPanel children={ReactNode} />`

- [ ] **Step 1: Write failing test for visibility**
```typescript
test('renders children inside glass panel', () => {
  render(<GlassPanel>Hello</GlassPanel>);
  expect(screen.getByText('Hello')).toBeInTheDocument();
});
```
- [ ] **Step 2: Implement GlassPanel with backdrop-blur and border**
```tsx
export const GlassPanel = ({ children }) => (
  <div className="backdrop-blur-md bg-white/10 border border-white/20 rounded-lg p-4">
    {children}
  </div>
);
```
- [ ] **Step 3: Run test and commit**

### Task 4: The ZoomContainer Primitive (The Core)
**Files:**
- Create: `src/components/primitives/ZoomContainer.tsx`
- Test: `src/components/primitives/ZoomContainer.test.tsx`

**Interfaces:**
- Consumes: `SPRING_CONFIG`
- Produces: `<ZoomContainer isExpanded={boolean} id={string}>`

- [ ] **Step 1: Write failing test for scale transition**
- [ ] **Step 2: Implement using `layoutId` and `motion.div`**
```tsx
export const ZoomContainer = ({ isExpanded, id, children }) => (
  <motion.div 
    layoutId={id} 
    transition={{ type: "spring", ...SPRING_CONFIG }}
    className={isExpanded ? "fixed inset-0 z-50 m-auto w-full max-w-2xl h-fit" : "relative"}
  >
    {children}
  </motion.div>
);
```
- [ ] **Step 3: Commit**

---

## Phase 3: Student Workspace Patterns

### Task 5: FocusQuestion Pattern
**Files:**
- Create: `src/components/patterns/FocusQuestion.tsx`

**Interfaces:**
- Consumes: `ZoomContainer`, `GlassPanel`
- Produces: `<FocusQuestion question={Question} />`

- [ ] **Step 1: Implement "Dive" logic (Scale $\rightarrow$ Center $\rightarrow$ Reveal)**
- [ ] **Step 2: Implement "Ascent" logic (Snap back to list)**
- [ ] **Step 3: Add adversarial content check (Scrollable area for long text)**
- [ ] **Step 4: Commit**

### Task 6: Exam Arena Integration
**Files:**
- Modify: `src/pages/ExamArena.tsx`

**Interfaces:**
- Consumes: `FocusQuestion`

- [ ] **Step 1: Replace static question view with `FocusQuestion`**
- [ ] **Step 2: Implement the "Question Map" with Spotlight highlights**
- [ ] **Step 3: Commit**

---

## Phase 4: Teacher Workspace Patterns

### Task 7: BankRow "Explode" Pattern
**Files:**
- Create: `src/components/patterns/BankRow.tsx`

**Interfaces:**
- Consumes: `ZoomContainer`, `GlassPanel`
- Produces: `<BankRow question={Question} />`

- [ ] **Step 1: Implement row-to-editor transition**
- [ ] **Step 2: Integrate `QuestionEditor` inside the exploded view**
- [ ] **Step 3: Commit**

### Task 8: Teacher Bank Command Center
**Files:**
- Modify: `src/pages/TeacherBank.tsx`

**Interfaces:**
- Consumes: `BankRow`

- [ ] **Step 1: Refactor list to use `BankRow` patterns**
- [ ] **Step 2: Implement background blur when any row is exploded**
- [ ] **Step 3: Commit**

---

## Phase 5: Polish & Reality Testing

### Task 9: Premium Effect Pass
**Files:**
- Modify: `src/components/primitives/GlassPanel.tsx`
- Modify: `src/components/patterns/FocusQuestion.tsx`

- [ ] **Step 1: Add "Success Pulse" animation to correct answers**
- [ ] **Step 2: Add "Error Shake" to invalid editor inputs**
- [ ] **Step 3: Implement Skeleton Shimmer for loading states**
- [ ] **Step 4: Commit**

### Task 10: Adversarial Content Audit
**Files:**
- Create: `tests/visual/adversarial-content.test.tsx`

- [ ] **Step 1: Test with 500-word question $\rightarrow$ Verify scroll and close button visibility**
- [ ] **Step 2: Test with 4K image $\rightarrow$ Verify `object-fit: contain`**
- [ ] **Step 3: Test 100+ items $\rightarrow$ Verify transition frames (60fps)**
- [ ] **Step 4: Final Commit**
