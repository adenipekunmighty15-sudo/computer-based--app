# UI/UX Rebuild: The "Focus-Zoom" Experience

> **Status:** Design Spec
> **Date:** 2026-09-28
> **Vision:** Transform the CBT app from a series of static pages into a fluid, immersive workspace using a "Dive and Ascent" motion architecture.

## 1. Design Philosophy
The rebuild is governed by the **Tokens $\rightarrow$ Primitives $\rightarrow$ Patterns** system. We move from "handmade one-offs" to a governed system where every interaction is a predictable pattern.

**Core Principle:** **Focus through Depth.** 
Instead of navigating *away* from context, the user *dives into* it. The "Focus-Zoom" effect ensures the user never loses their place in the overall workflow while accessing deep details.

---

## 2. The Motion Architecture: "Dive & Ascent"

### 2.1 The Explode (The Dive)
When a user selects a `QuestionCard` or `BankRow`, the following sequence occurs:
1. **Zoom (C-Path):** The element translates from its current position to the center of the viewport and scales up (e.g., `scale: 1.0` $\rightarrow$ `scale: 1.2`).
2. **Depth (B-Path):** 
   - **Background:** The surrounding list scales down to `0.95`, opacity drops to `40%`, and a `backdrop-filter: blur(12px)` is applied.
   - **Foreground:** The active card gains a `soft-elevation` shadow and a `glassmorphism` border.
3. **Reveal:** Once centered, the internal content (detailed explanations, marking guides) fades in from `opacity: 0` with a slight `translate-y: 20px` slide.

### 2.2 The Retract (The Ascent)
1. **Snap:** The card scales back to `1.0` and translates precisely back to its original coordinates in the list.
2. **Restore:** The background list scales back to `1.0` and opacity returns to `100%`.
3. **Clean-up:** The blur overlay fades out.

### 2.3 Motion Tokens
- **Spring Curve:** `cubic-bezier(0.175, 0.885, 0.32, 1.275)` (for that organic "pop" feel).
- **Duration:** `400ms` for main transitions; `150ms` for micro-interactions.

---

## 3. Workspace Map

### 3.1 Student Workspace (The Learning Flow)
| Screen | Primary Pattern | Key Interaction | Effect |
| :--- | :--- | :--- | :--- |
| **Exam Hub** | `DiscoveryGrid` | Card Selection | Hover Lift $\rightarrow$ Zoom to Briefing |
| **Exam Arena** | `FocusStage` | Question Switching | Spotlight Highlight on Active Q |
| **Review Mode** | `ComparisonDive` | Explode Question | Zoom into Answer vs. Correct explanation |
| **Result Vault** | `PerformanceList` | Mistake Review | Dive from Result Row $\rightarrow$ Original Question |

### 3.2 Teacher Workspace (The Management Flow)
| Screen | Primary Pattern | Key Interaction | Effect |
| :--- | :--- | :--- | :--- |
| **Bank Command** | `DenseInventory` | Edit Question | Row Explode $\rightarrow$ Full-screen Editor |
| **Paper Architect** | `DualPaneLayout` | Drag & Drop | Zoom-transition from Bank $\rightarrow$ Paper |
| **Analytics Lens** | `InsightChart` | Drill-down | Chart Point $\rightarrow$ Explode Student List |

---

## 4. Visual & Interaction Suite

### 4.1 Visual Effects (The "Premium" Layer)
- **Glassmorphism:** Applied to all "exploded" views (Frosted glass effect with `border: 1px solid rgba(255,255,255,0.1)`).
- **Soft Elevation:** Depth levels defined by shadow tokens (`--shadow-1` to `--shadow-4`).
- **Spotlight:** A subtle radial gradient that follows the cursor or highlights the active element in the Question Map.

### 4.2 Feedback Micro-interactions
- **Success Pulse:** When a student selects the correct answer in Review Mode, the choice pulses green with a `scale: 1.05` bounce.
- **Error Shake:** Invalid inputs in the Teacher Editor trigger a brief horizontal shake.
- **Skeleton Shimmer:** All loading states use a `linear-gradient` shimmer moving left-to-right.

---

## 5. Content Reality Guard (The Non-Negotiable)

The "Focus-Zoom" must not break under real-world data:
- **Long Text:** "Exploded" views must use an internal scroll area if content exceeds 80% of viewport height.
- **Large Media:** Images in zoomed views must use `object-fit: contain` to prevent layout overflow.
- **High Volume:** The "Ascent" back to a list of 100+ items must be handled via `layoutId` to prevent browser jank.

---

## 6. Component Hierarchy
**Tokens** $\rightarrow$ **Primitives** $\rightarrow$ **Patterns**

- **Primitives to Build:**
  - `ZoomContainer`: The core animation wrapper.
  - `GlassPanel`: The frosted UI surface.
  - `MotionSpring`: A wrapper for consistent transition timings.
- **Patterns to Compose:**
  - `FocusQuestion`: `ZoomContainer` + `GlassPanel` + `QuestionUI`.
  - `BankRow`: `DenseRow` + `ZoomContainer` $\rightarrow$ `QuestionEditor`.
