# Design System Plan — One Source of Truth

**Owner:** Design Lead, in partnership with Engineering + Product
**Status:** Plan (deliverable 1 of 3)
**Products in scope:** All teams shipping UI under this repo umbrella (starting with the CBT Question Lab).

---

## 1. The problem we keep paying for

Every previous attempt produced a library of *looks*, not a system of *agreements*.
The visible symptoms were:

- The same control (a text input) styled 4 different ways across 4 teams.
- Components hand-building spacing, radius, and type from memory instead of from a scale.
- Naming chaos: `btn`, `button`, `cta-button`, `ActionButton` — all meaning the same thing.
- "It works in the demo" components that break under real content (long answers, 100-question papers, empty states).
- No shared inventory, so nobody knew what already existed → teams silently re-built it → drift.

A design system fails when it is a figma file that devs are told to "follow."
It works when it is a **governed set of tokens + primitives + patterns** compiled into the codebase,
with rules for adding to it and proof against the content constraints that actually ship.

## 2. Three stakeholders, one contract

| Stakeholder | Pressure | What they need | What the system gives them |
|---|---|---|---|
| Product/Exec | Ship fast, no re-review of the same thing | Speed | Reusable, pre-approved primitives; new screens compile from existing parts |
| Designers | Pixel-perfect consistency | Single authority on spacing/type/color | The **token file is the truth**. Designers review one file, not N components |
| Engineers | Components that work under real load | Content-proof, self-contained components | Primitives built against adversarial content, not the happy path |

The system is a **contract**: designers own the tokens and naming; engineers own
primitive behavior and accessibility; product owns which patterns ship. Anyone
may propose, the governance step approves.

## 3. Architecture — three layers, one source of truth

```
TOKENS ──── the only place raw values live (color, type, space, radius, shadow, motion)
   │
   ▼
PRIMITIVES ── ~10 dumb-but-robust components. No product logic. Styled only by tokens.
   │
   ▼
PATTERNS ── compositions of primitives that solve one job
             (e.g., "empty state", "results list", "bank row")
```

Rule: **a component may consume tokens + primitives only.**
A pattern may consume tokens + primitives + other patterns.
No component ever hardcodes a raw value.

### 3.1 Tokens (the single source of truth)

Defined once as CSS variables (and mirrored as JS constants for runtime use).

```css
:root {
  /* color */
  --c-bg:        #0F1115;   /* app background          */
  --c-surface:   #161A22;   /* cards, panels           */
  --c-surface-2: #1D2330;   /* raised, hover           */
  --c-border:    #2A3140;
  --c-text:      #F2F5FA;
  --c-text-dim:  #9AA5B8;
  --c-primary:   #2DD4BF;   /* the one accent          */
  --c-primary-ink:#06231F;  /* text on accent          */
  --c-good:      #4ADE80;
  --c-bad:       #F87171;

  /* type scale — sizes, weights, line-heights */
  --t-xs: 0.75rem;  --t-sm: 0.875rem;  --t-md: 1rem;
  --t-lg: 1.25rem;  --t-xl: 1.625rem;  --t-2xl: 2.25rem;
  --t-display: 3rem;
  --w-condensed: 600;  /* numbers, labels */
  --w-body: 400;
  --lh-tight: 1.15;  --lh-normal: 1.5;  --lh-loose: 1.7;

  /* spacing scale — every gap/pad comes from here, nothing else */
  --s-1: 4px; --s-2: 8px; --s-3: 12px; --s-4: 16px;
  --s-5: 24px; --s-6: 32px; --s-8: 48px; --s-10: 64px;

  /* radius / shadow / motion */
  --r-sm: 6px; --r-md: 10px; --r-lg: 16px;
  --shadow-1: 0 1px 2px rgb(0 0 0 / .4);
  --shadow-2: 0 8px 24px rgb(0 0 0 / .4);
  --dur-fast: 120ms; --dur: 200ms; --ease: cubic-bezier(.2,.7,.3,1);
}
```

Governance law: **raw values live only here.** New palettes/type = token additions,
never component edits. Designers review this one file to approve global change.

### 3.2 Primitives (≤ 10, content-proof)

Build each against *adversarial content*, not the mock:

| Primitive | Must survive |
|---|---|
| `Button` (primary/ghost/danger, sizes, loading, disabled) | Long labels, icon+text, focus ring |
| `Input` / `Select` / `Textarea` | Long placeholder, error + hint, overflow |
| `Card` | Arbitrary nesting, sticky footer area |
| `Field` (label + control + hint + error) | Left-aligned labels, multi-line hints |
| `Badge` / `Tag` | Long text truncation, inline density |
| `List` / `ListRow` | 100+ rows, item actions, empty state slot |
| `EmptyState` | Direction, not decoration |
| `Dialog` | Scroll-lock, escape, focus trap, long content |
| `Spinner` / `Loading` | Blocking + inline contexts |
| `Divider`, `Eyebrow`, `SectionHead` | Structural labels only |

Every primitive follows the same skeleton: **tokens → layout → variants → states → a11y**,
and exports typed props so misuse fails at compile time, not at demo time.

### 3.3 Patterns (one way to do a job)

Equivalent situations must compile to one component, so developers cannot improvise:

- **Form layout** (grid of `Field`s + submit row)
- **Results view** (header meta + question list + save/export actions)
- **Question card** (numbered, options, reveal-answer, marks, tags)
- **Bank row + bank list** (dense, actions, empty → EmptyState)
- **Status pill / model indicator**

Pattern duplication is a review blocker: "is this job already patented by a pattern?" must
yield a yes-or-no answer in the inventory, not a shrug.

## 4. Content reality check (the engineering non-negotiable)

All primitives are validated against the real content this product family ships:

- Option text long enough to wrap twice (never clip answers).
- 100-question papers in a single list — virtualization-ready rows, no jank.
- Theory answers with multi-line marking guides.
- Empty states with a clear next action.
- Keyboard focus visible on every interactive element; `prefers-reduced-motion` honored.

The acceptance bar: **a component that breaks under any of these is a bug,
not an edge case.** This is what converts "works in the demo" into "works in production."

## 5. Naming + inventory (kills the drift loop)

- One vocabulary: `Button`, not `ActionButton`; `Field`, not `FormControl`.
- A single **component inventory** (one markdown/JSON manifest per package) listing
  what exists, its status, and its consuming patterns. CI fails if a new component
  is added whose job a pattern already covers.
- A tight naming glossary in the repo root so "is this already built?" is checkable
  in seconds by any developer on any team.

## 6. Governance & workflow (how changes land)

**Propose → approve → build → ship → inventory.**
- Designers propose *token/pattern* changes. Engineering approves if it survives the content tests.
- Engineers propose *primitive/behavior* changes. Design approves the visual result against the token file.
- Both are mandatory on: new patterns, new primitives, token changes. Neither can ship one-sided changes alone.
- Semver the kit: adding a token/primitive = minor; renaming/removing = major (forces a migration, no silent breakage).
- **No per-team forks.** If a team needs different behavior, the answer is a variant or a new pattern, both governed — never a copy-paste of a primitive.

## 7. Phasing (deliver under pressure, in order of leverage)

1. **Tokens + palette** (day 1–2): the single source of truth, applied to the Question Lab's `App.css` so every team sees the pattern.
2. **Primitives audit** (day 3–5): rewrite existing controls in the Lab onto primitives; delete the bespoke variants as they go (this is where the current tech debt is paid down).
3. **Patterns + inventory manifest** (week 2): extract results view, form layout, bank rows; publish the inventory so other teams reuse instead of rebuild.
4. **CI guards + governance doc** (week 2–3): automated checks — no raw hex outside tokens, no duplicate-pattern PRs.
5. **Scale to second team** (week 3+): on-board by consuming the inventory, not by reading tribal knowledge.

Fastest visible win for stakeholders: tokens, because it makes every screen look
"designed" overnight. Fastest engineering win: primitives against real content,
because it kills the demo-vs-production gap.

## 8. Anti-patterns this system explicitly bans

- ❌ Hardcoded colors/spacing/radius anywhere outside tokens.
- ❌ Magic numbers for layout (8px is `--s-2`, not a guess).
- ❌ Two components for the same job.
- ❌ Forking a primitive into a team-local copy.
- ❌ Shipping a component that passes demo but fails the content checks above.
- ❌ Renaming a token/pattern without a major-version migration.

## 9. Definition of done

A feature is "done" when the UI is: (a) tokens-only, (b) built on primitives,
(c) proofed against the content table in §4, (d) reflected in the inventory manifest.
Anything else is a handmade one-off — which is exactly the debt we're deleting.