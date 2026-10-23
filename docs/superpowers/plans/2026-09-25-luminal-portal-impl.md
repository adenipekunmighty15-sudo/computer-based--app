# Luminal Portal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the CBT app visual identity to a high-fidelity, glass-morphic experience based on the Luminal Portal design spec.

**Architecture:** 
1. Establish a new "Optical" design token system in Tailwind and CSS variables.
2. Upgrade core UI components to use "Glass" surfaces and "Precision" interactions.
3. Implement "Bento" layout patterns on dashboard pages.
4. Add "Spatial" motion and "Focus Mode" interactions to the Exam UI.

**Tech Stack:** React, Tailwind CSS, CSS Variables.

**Spec:** `docs/superpowers/specs/2026-09-25-luminal-portal-design.md`

## Global Constraints
- Palette: Electric Gold, Deep Space Blue, and Obsidian gradients.
- Typography: High-contrast pairing (Inter Tight/Plus Jakarta for headings, Monospace for metadata).
- Surface: Standardized Glassmorphism (`backdrop-filter: blur(20px)`, `1px` thin borders).
- Motion: Quintic easing `cubic-bezier(0.22, 1, 0.36, 1)`.

## Review Focus
- **Contrast in Light Mode:** Ensure "Electric Gold" accents maintain WCAG accessibility on cream backgrounds.
- **Glass Performance:** Verify that multiple layered `backdrop-filter` elements do not cause lag on lower-end devices.
- **Exam Focus Mode:** Ensure the "Environmental Dimming" does not make critical timer/navigator elements hard to see.
- **Bento Responsiveness:** Ensure asymmetric grids collapse gracefully to a single column on mobile without losing hierarchy.
- **Motion Reduction:** Respect `prefers-reduced-motion` by disabling spatial slides and bounces while keeping the visual style.

---

## File Map

### Configuration
- `tailwind.config.js`: Extend colors, spacing, and animation curves.
- `src/index.css`: Update CSS variables for the Luminal palette and glass effects.

### UI Components
- `src/components/ui/Button.tsx`: Implement "Precision" buttons (backlit, ghost styles).
- `src/components/ui/Card.tsx`: Implement "Bento" tiles with accent markers.
- `src/components/ui/Input.tsx`, `src/components/ui/Select.tsx`: Implement "Fluid" focus states and floating labels.
- `src/components/ui/Badge.tsx`: Update to high-contrast styles.

### Patterns & Pages
- `src/components/patterns/Topbar.tsx`: Implement the integrated progress line for exams.
- `src/pages/TeacherApp.tsx`, `src/pages/StudentApp.tsx`: Convert lists to Bento grids.
- `src/components/patterns/QuestionCard.tsx`: Implement "Selection Bounce" and "Focus Mode" styling.
- `src/components/ui/NavIcon.tsx`: Refine 3D animations for the new palette.

---

## Implementation Tasks

### Task 1: Core Design Tokens (Palette & Type)

**Files:**
- Modify: `tailwind.config.js`
- Modify: `src/index.css`

**Interfaces:**
- Produces: Global CSS variables (`--luminal-gold`, `--luminal-blue`, `--glass-border`, etc.) and Tailwind utility classes.

- [ ] **Step 1: Update `tailwind.config.js` with the Luminal palette and quintic easing.**
  - Add `colors: { luminal: { gold: '#...', blue: '#...', space: '#...' } }`
  - Add `transitionTimingFunction: { 'luminal-ease': 'cubic-bezier(0.22, 1, 0.36, 1)' }`
- [ ] **Step 2: Update `src/index.css` variables for Light/Dark modes.**
  - Replace flat colors with gradients for `--canvas`.
  - Define `--glass-border: rgba(255, 255, 255, 0.1)` and `--glass-fill: rgba(255, 255, 255, 0.03)`.
- [ ] **Step 3: Implement High-Contrast Typography in `src/index.css`.**
  - Add font-family rules for headings (Inter Tight) and metadata (Monospace).
- [ ] **Step 4: Commit**
  - `git commit -m "style: establish luminal design tokens"`

### Task 2: Precision Components (Buttons & Inputs)

**Files:**
- Modify: `src/components/ui/Button.tsx`
- Modify: `src/components/ui/Input.tsx`
- Modify: `src/components/ui/Select.tsx`

**Interfaces:**
- Consumes: Tokens from Task 1.

- [ ] **Step 1: Implement "Precision" Button styles in `Button.tsx`.**
  - Add `scale(1.02)` on hover and `scale(0.98)` on active.
  - Implement "Backlit" primary style using radial gradients and soft colored box-shadows.
- [ ] **Step 2: Implement "Fluid" Input focus in `Input.tsx` and `Select.tsx`.**
  - Add animated underline that expands from center on focus.
  - Apply `glass` surface effect to inactive state.
- [ ] **Step 3: Implement Floating Labels for inputs.**
  - Add CSS transition to move label to "eyebrow" position on focus/value-present.
- [ ] **Step 4: Commit**
  - `git commit -m "feat: implement precision buttons and fluid inputs"`

### Task 3: Bento Architecture (Cards & Layouts)

**Files:**
- Modify: `src/components/ui/Card.tsx`
- Modify: `src/pages/TeacherApp.tsx`
- Modify: `src/pages/StudentApp.tsx`

**Interfaces:**
- Consumes: Tokens from Task 1.

- [ ] **Step 1: Upgrade `Card.tsx` to "Bento Tile" spec.**
  - Add `backdrop-filter: blur(20px)` and the `1px` top-edge inner glow.
  - Add optional `accentColor` prop to render the 2px vertical marker in the top-left.
- [ ] **Step 2: Implement "Lift" interaction on card hover.**
  - Add `transform: translateY(-4px)` and increase border brightness.
- [ ] **Step 3: Refactor `TeacherApp.tsx` and `StudentApp.tsx` to use Bento grids.**
  - Replace linear lists with `display: grid` and `grid-template-columns: repeat(4, 1fr)`.
  - Assign `span 2` or `span 1` to tiles to create the asymmetric rhythm.
- [ ] **Step 4: Commit**
  - `git commit -m "feat: implement bento layout and glass cards"`

### Task 4: The Precision Exam UI (Navigator & Flow)

**Files:**
- Modify: `src/components/patterns/Topbar.tsx`
- Modify: `src/components/patterns/QuestionCard.tsx`
- Modify: `src/components/ui/RadioOption.tsx` (or where options are rendered)

**Interfaces:**
- Consumes: Tokens from Task 1.

- [ ] **Step 1: Implement the integrated Progress Line in `Topbar.tsx`.**
  - Move progress bar to the very top of the viewport as a thin `2px` line.
- [ ] **Step 2: Redesign the Question Navigator.**
  - Change question indicators from squares to "pills".
  - Add "breathing" glow animations for answered/flagged states using `@keyframes`.
- [ ] **Step 3: Implement "Selection Bounce" in `RadioOption.tsx`.**
  - Add a CSS animation that scales the selected option slightly.
- [ ] **Step 4: Implement "Focused Exam State" in `QuestionCard.tsx`.**
  - Add a CSS class that dims background aurora elements when active.
- [ ] **Step 5: Commit**
  - `git commit -m "feat: upgrade exam UI to precision navigator and focused state"`

### Task 5: Spatial Motion & Polishing

**Files:**
- Modify: `src/index.css`
- Modify: `src/components/feedback/Toast.tsx`

**Interfaces:**
- Consumes: Tokens from Task 1.

- [ ] **Step 1: Implement Spatial Page Transitions.**
  - Add a global `.page-transition` class with `slide-in` and `scale` effects.
- [ ] **Step 2: Update global easing to Quintic (`cubic-bezier(0.22, 1, 0.36, 1)`).**
  - Replace linear/ease-in-out transitions in `index.css` with the new easing.
- [ ] **Step 3: Upgrade Toast animations.**
  - Implement slide-in from bottom-right and shrink-out dismiss animations.
- [ ] **Step 4: Commit**
  - `git commit -m "style: add spatial motion and refined micro-interactions"`
