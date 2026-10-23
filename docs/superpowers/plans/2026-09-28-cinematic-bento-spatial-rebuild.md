# Cinematic Bento-Spatial Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the CBT app UI/UX into a high-fidelity, immersive "Midnight Neon" experience featuring bento-spatial navigation and aggressive animations.

**Architecture:** A layered approach starting with a global `AnimationContext` for state orchestration, moving to a custom `BentoGrid` using `framer-motion` for spatial transitions, and ending with a "Glassmorphic" component library.

**Tech Stack:** React, Framer Motion, Tailwind CSS, Zustand (for AnimationContext).

**Spec:** `docs/superpowers/specs/2026-09-28-cinematic-bento-spatial-design.md`

## Global Constraints
- Background: Deep multi-layered gradient (`#020617` to `#0f172a`) with 2% noise texture.
- Palette: Cyber Blue (`#3b82f6`), Electric Emerald (`#10b981`), Vivid Crimson (`#ef4444`), Neon Purple (`#a855f7`).
- Surfaces: Glassmorphism (`backdrop-filter: blur(12px)`, `rgba(255, 255, 255, 0.05)` fill, `1px` border).
- Typography: *Archivo* for headings, *Inter* for body.
- Performance: Maintain 60fps during spatial transitions.

## Review Focus
- **Transition Collision:** Rapidly clicking multiple tiles during an active "Explosion" transition. Expected: Graceful cancellation or queuing of the next animation.
- **Accessibility Contrast:** Glassmorphic surfaces over ambient glow blobs. Expected: Text must maintain WCAG AA contrast regardless of background blob position.
- **Viewport Scaling:** Spatial explosion on extremely small mobile screens. Expected: Elements scale proportionally without clipping off-screen.
- **Exam Focus:** Distracting "ambient glows" during a live exam. Expected: Glows should dim or freeze when in `StudentExam.tsx` to maintain student concentration.
- **Z-Index Depth:** Retracting a view while a "pop-out" detail is still open. Expected: The pop-out should retract first or be destroyed before the main view collapses.

---

## File Structure

- `src/contexts/AnimationContext.tsx` - Global state for `IDLE`, `EXPLODING`, `RETRACTING`.
- `src/components/spatial/BentoGrid.tsx` - The orchestrator for the grid and `layoutId` transitions.
- `src/components/spatial/BentoTile.tsx` - Individual tile with magnetic repulsion logic.
- `src/components/spatial/SpatialWrapper.tsx` - Handles the Z-axis depth shift and scale for background.
- `src/components/ui/GlassPanel.tsx` - The base glassmorphic surface component.
- `src/components/ui/CinematicButton.tsx` - Liquid-fill interactive button.
- `src/styles/tokens.css` - Updated with Midnight Neon color variables.
- `src/styles/ambient.css` - New styles for ambient glow blobs and noise texture.

---

## Implementation Tasks

### Task 1: Visual Foundation & Global Styles

**Files:**
- Modify: `src/styles/tokens.css`
- Create: `src/styles/ambient.css`
- Modify: `src/index.css`

**Interfaces:**
- Produces: CSS variables for the Midnight Neon palette.

- [ ] **Step 1: Update `tokens.css` with the spec's color palette**
```css
:root {
  --bg-deep: #020617;
  --bg-light: #0f172a;
  --accent-blue: #3b82f6;
  --accent-emerald: #10b981;
  --accent-crimson: #ef4444;
  --accent-purple: #a855f7;
  --glass-bg: rgba(255, 255, 255, 0.05);
  --glass-border: rgba(255, 255, 255, 0.1);
}
```
- [ ] **Step 2: Create `ambient.css` for the noise texture and glow blobs**
```css
.ambient-bg {
  background: linear-gradient(to bottom right, var(--bg-deep), var(--bg-light));
  position: relative;
  overflow: hidden;
}
.ambient-noise {
  content: "";
  position: absolute;
  inset: 0;
  opacity: 0.02;
  pointer-events: none;
  background-image: url('data:image/svg+xml,...'); /* Noise SVG */
}
.glow-blob {
  position: absolute;
  filter: blur(80px);
  opacity: 0.3;
  z-index: 0;
  animation: float 20s infinite alternate;
}
@keyframes float {
  from { transform: translate(0, 0); }
  to { transform: translate(100px, 50px); }
}
```
- [ ] **Step 3: Apply base styles to `index.css`**
  Add `.ambient-bg` and `.ambient-noise` to the root layout.
- [ ] **Step 4: Verify visual baseline**
  Run app and verify background is deep navy with subtle noise and moving blobs.
- [ ] **Step 5: Commit**
  `git add src/styles/ tokens.css index.css && git commit -m "style: implement midnight neon visual foundation"`

### Task 2: Global Animation Orchestrator

**Files:**
- Create: `src/contexts/AnimationContext.tsx`
- Modify: `src/main.tsx`

**Interfaces:**
- Produces: `useAnimation()` hook providing `status` (`IDLE` | `EXPLODING` | `RETRACTING`) and `setStatus(status)`.

- [ ] **Step 1: Implement `AnimationContext` using Zustand**
```typescript
type AnimationStatus = 'IDLE' | 'EXPLODING' | 'RETRACTING';
interface AnimationState {
  status: AnimationStatus;
  setStatus: (status: AnimationStatus) => void;
}
export const useAnimation = create<AnimationState>((set) => ({
  status: 'IDLE',
  setStatus: (status) => set({ status }),
}));
```
- [ ] **Step 2: Wrap app in `main.tsx` with the provider**
- [ ] **Step 3: Verify state transitions**
  Add temporary buttons to trigger `setStatus` and log the current status to console.
- [ ] **Step 4: Commit**
  `git add src/contexts/AnimationContext.tsx src/main.tsx && git commit -m "feat: add global animation orchestrator"`

### Task 3: Glassmorphic Surface System

**Files:**
- Create: `src/components/ui/GlassPanel.tsx`
- Create: `src/components/ui/CinematicButton.tsx`

**Interfaces:**
- Produces: `<GlassPanel />` (takes children, padding, blur amount).
- Produces: `<CinematicButton />` (takes onClick, label).

- [ ] **Step 1: Implement `GlassPanel`**
```tsx
export const GlassPanel = ({ children, className }) => (
  <div className={`backdrop-blur-md bg-white/5 border border-white/10 rounded-2xl ${className}`}>
    {children}
  </div>
);
```
- [ ] **Step 2: Implement `CinematicButton` with liquid fill**
  Use `framer-motion` to animate a background div that fills on hover/click.
- [ ] **Step 3: Test contrast against ambient glow blobs**
  Ensure text on `GlassPanel` is readable when a glow blob passes behind it.
- [ ] **Step 4: Commit**
  `git add src/components/ui/ && git commit -m "feat: implement glassmorphic UI system"`

### Task 4: Spatial Bento Grid Core

**Files:**
- Create: `src/components/spatial/BentoGrid.tsx`
- Create: `src/components/spatial/BentoTile.tsx`
- Create: `src/components/spatial/SpatialWrapper.tsx`

**Interfaces:**
- Consumes: `useAnimation()`
- Produces: `<BentoGrid />` containing multiple `<BentoTile />`.

- [ ] **Step 1: Implement `SpatialWrapper` for Z-axis depth**
```tsx
export const SpatialWrapper = ({ children }) => {
  const { status } = useAnimation();
  return (
    <motion.div 
      animate={{ 
        scale: status === 'EXPLODING' ? 0.9 : 1,
        rotateX: status === 'EXPLODING' ? 5 : 0,
        z: status === 'EXPLODING' ? -100 : 0 
      }}
      style={{ perspective: 1000 }}
    >
      {children}
    </motion.div>
  );
};
```
- [ ] **Step 2: Implement `BentoTile` with magnetic repulsion**
  Use `useMotionValue` to track mouse position and apply a subtle offset to the tile's `x` and `y`.
- [ ] **Step 3: Implement `BentoGrid` with `layoutId` transitions**
  Configure the grid so that clicking a tile sets `status = 'EXPLODING'` and triggers the `layoutId` expansion to full screen.
- [ ] **Step 4: Verify "Explosion" and "Retraction" cycle**
  Ensure tile expands to $100vw/100vh$ and shrinks back to the correct grid slot.
- [ ] **Step 5: Commit**
  `git add src/components/spatial/ && git commit -m "feat: implement spatial bento grid with explosions"`

### Task 5: Integrating Pages into Spatial Flow

**Files:**
- Modify: `src/pages/StudentApp.tsx`
- Modify: `src/pages/StudentExam.tsx`
- Modify: `src/pages/TeacherApp.tsx`

**Interfaces:**
- Consumes: `<BentoGrid />`, `<BentoTile />`, `<GlassPanel />`.

- [ ] **Step 1: Refactor `StudentApp.tsx` into a Bento Dashboard**
  Replace standard lists with a `BentoGrid` of tiles (e.g., "Active Exams", "Performance Stats", "Profile").
- [ ] **Step 2: Link `BentoTile` to `StudentExam.tsx` via Spatial Explosion**
  Use the `layoutId` from the tile to animate the transition into the exam view.
- [ ] **Step 3: Implement "Retract" button in `StudentExam.tsx`**
  Call `setStatus('RETRACTING')` to trigger the collapse back to the dashboard.
- [ ] **Step 4: Verify mobile viewport scaling**
  Test the explosion on a mobile screen size to ensure no clipping.
- [ ] **Step 5: Commit**
  `git add src/pages/ && git commit -m "feat: integrate pages into spatial bento flow"`
