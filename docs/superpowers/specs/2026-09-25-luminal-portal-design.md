# Design Specification: The Luminal Portal
**Date:** 2026-09-25
**Status:** Approved / Pending Implementation
**Project:** CBT App for T Gold Brighter Tomorrow Model School

## 1. Vision & Intent
The goal is to transition the application from a sophisticated utility to a world-class, high-fidelity digital experience. Drawing inspiration from `horizon.so`, the "Luminal Portal" design focuses on **Intentional Negative Space**, **High-Contrast Typography**, and **Subtle Depth**. The result should feel like a premium "Academic Portal"—prestigious yet cutting-edge.

## 2. Visual Language

### 2.1 The Luminal Palette
Shift from flat colors to "optical" colors that simulate light emission.

| Element | Light Mode | Dark Mode | Note |
| :--- | :--- | :--- | :--- |
| **Background** | `var(--canvas)` $\rightarrow$ Soft Cream | `var(--canvas)` $\rightarrow$ Deep Obsidian/Navy Gradient | Radial gradient for depth |
| **Primary Accent** | Electric Gold | Vibrant Metallic Gold | Higher saturation, "backlit" feel |
| **Secondary Accent** | Deep Space Blue | Electric Cobalt | Used for a "technical" contrast |
| **Text (Heading)** | Deep Ink | Pure White | `font-weight: 800` |
| **Text (Body)** | Muted Slate | Silver-Grey | High legibility, `line-height: 1.6` |
| **Text (Meta)** | Gold-muted | Soft Gold | Monospaced for precision |

### 2.2 Typography System
Using a high-contrast pairing to create a clear information hierarchy.

- **Display/Headings:** `Inter Tight` or `Plus Jakarta Sans`. 
  - Style: Bold (800), tight letter-spacing (`-0.03em`).
- **UI/Metadata:** `JetBrains Mono` or `IBM Plex Mono`.
  - Style: Regular (400), used for counters, timers, and IDs.
- **Body Text:** `Inter`.
  - Style: Regular (400), optimized for long-form reading.

### 2.3 Surface & Depth (Glassmorphism)
Standardizing the "Glass" layer to create spatial depth.

- **Glass Specification:**
  - **Fill:** `rgba(255, 255, 255, 0.03)` (Dark) / `rgba(0, 0, 0, 0.02)` (Light)
  - **Blur:** `backdrop-filter: blur(20px) saturate(1.3)`
  - **Border:** `1px solid rgba(255, 255, 255, 0.1)`
  - **Inner Glow:** `1px` top-edge highlight to simulate overhead lighting.

---

## 3. Component Overhauls

### 3.1 The "Precision" Button
- **Hover:** `scale(1.02)`, increase outer-glow intensity.
- **Active:** `scale(0.98)`, slight darkening of fill.
- **Primary:** Backlit effect with a soft radial gradient and matching colored shadow.
- **Secondary:** "Ghost" style—transparent fill, thin border, lights up on hover.

### 3.2 The "Bento" Card
- **Layout:** Transition from lists to an asymmetric grid.
- **Detailing:** Top-left "Accent Marker" (2px line) for category color-coding.
- **Interaction:** Hover increases blur and border brightness, creating a "lift" effect.

### 3.3 The "Fluid" Input
- **Focus State:** Animated underline expanding from center.
- **Labeling:** Floating labels that transition to "eyebrow" positions.
- **Styling:** Integrated glass surfaces that blend into the background when inactive.

### 3.4 The "Precision" Navigator (Exam UI)
- **Question Indicators:** Transition from squares to elegant pills.
- **Status Indicators:** 
  - Answered $\rightarrow$ Soft breathing green glow.
  - Flagged $\rightarrow$ Steady amber pulse.
- **Progress:** Integrated thin line at the very top of the viewport.

---

## 4. Motion & Interaction

### 4.1 Spatial Transitions
- **Page-to-Page:** Slide-in from right with a `scale(0.95) \rightarrow 1.0` transition.
- **Easing:** Global use of `cubic-bezier(0.22, 1, 0.36, 1)` for a snappy, organic feel.

### 4.2 Micro-Feedback
- **Selection:** "Bounce" animation (scale pop) on option selection.
- **Loading:** Skeleton shimmers with moving light-gradients instead of central spinners.
- **Toasts:** Slide-in from bottom-right, shrink-out on dismiss.

### 4.3 Focused Exam State
- **Environmental Dimming:** Slowing down background animations and dimming aurora effects when in "Exam Mode."
- **Question Flow:** Smooth vertical sliding transition between questions.
