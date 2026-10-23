# Design Spec: The Cinematic Bento-Spatial Experience
**Date:** 2026-09-28
**Status:** Finalized
**Target:** CBT App UI/UX Rebuild

## 1. Vision & Intent
Transform the CBT app from a standard utility tool into a high-end, immersive digital experience. The core philosophy is **"Spatiality over Pages"**—moving between views should feel like moving through a 3D environment, utilizing "explosions" and "retractions" to create a cinematic flow.

## 2. Visual Identity: "Midnight Neon"
### 2.1 Color Palette
- **Base:** Deep multi-layered gradient (`#020617` $\rightarrow$ `#0f172a`) with a 2% opacity noise texture overlay.
- **Surfaces:** Glassmorphic tiles (`backdrop-filter: blur(12px)`, `rgba(255, 255, 255, 0.05)` fill, `1px` semi-transparent border).
- **Accents:**
  - **Cyber Blue (`#3b82f6`):** Primary actions, active states.
  - **Electric Emerald (`#10b981`):** Success, correct answers.
  - **Vivid Crimson (`#ef4444`):** Errors, incorrect answers.
  - **Neon Purple (`#a855f7`):** Special highlights, teacher-mode accents.

### 2.2 Typography
- **Display:** *Archivo* (Bold, Tight tracking) for headings to create an editorial, architectural feel.
- **Interface:** *Inter* (Regular, Optimized spacing) for body text and test content to ensure maximum legibility.

### 2.3 Environmental Effects
- **Ambient Glows:** 3-4 large, low-opacity blurred circles moving in a slow, randomized Brownian motion in the background.
- **Magnetic Repulsion:** Tiles subtly shift away from the cursor on hover.

## 3. Interaction Model: "Spatial Orchestration"
### 3.1 The Bento Explosion
- **Trigger:** Clicking a Bento Tile.
- **Action:** 
  - The selected tile expands from its grid coordinates to $100vw/100vh$ using `layoutId`.
  - Non-selected tiles scale down to $0.8x$ and fade to $0\%$ opacity.
  - Background shifts from a 2D plane to a 3D perspective (scaled back $10\%$, rotated $5^\circ$ on X-axis).
- **Physics:** Stiff spring ($\text{stiffness}: 300, \text{damping}: 30$) for a snappy, professional feel.

### 3.2 The Retraction
- **Trigger:** "Back" or "Exit" action.
- **Action:** The full-screen view collapses precisely back into its origin Bento slot.
- **Physics:** Bouncy spring ($\text{stiffness}: 200, \text{damping}: 20$) to provide a satisfying "snap-back" effect.

### 3.3 Internal "Pop-outs"
- **Action:** Secondary details (e.g., student profiles) "explode" outward from their anchor point with a Z-axis lift.
- **Visual:** Casts a dynamic shadow that grows as the element "lifts" off the page.

## 4. Technical Architecture
### 4.1 Animation Engine
- **Library:** `framer-motion` for all layout transitions and gesture-based animations.
- **State Management:** A global `AnimationContext` to synchronize the "Explode/Retract" states and prevent animation collisions.

### 4.2 Component Strategy
- **BentoGrid:** A custom wrapper that calculates child positions to facilitate `layoutId` transitions.
- **GlassPanel:** A reusable wrapper for all surfaces implementing the glassmorphic style.
- **CinematicButton:** Buttons with "liquid fill" transitions and haptic-style scale effects.

## 5. Success Criteria
- **Wow Factor:** The transition from Dashboard $\rightarrow$ Exam must feel like a single, fluid motion.
- **Performance:** Maintain $60\text{fps}$ during spatial transitions.
- **Legibility:** The high-end aesthetic must not compromise the accessibility of the CBT exam content.
