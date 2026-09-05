# SharePix design system

Structure extracted from the reference prototype (screenshots, mobile
Safari); colour is SharePix's own. This is the spec Phase 2 implements;
pages come later.

## The three signature moves

Everything else is detail. These are what make the reference look like the
reference:

1. **Sharp corners.** Buttons, cards, pricing tiles, badges, image tiles — all
   rectangles. No border radius anywhere except the arch motif and the small
   circular step icons. This is most of why it reads editorial rather than
   SaaS, and it is the biggest departure from what the site does today
   (`rounded-2xl` on nearly everything).
2. **The two-font headline.** Line one in bold geometric sans, line two in
   italic serif:
   > **Every moment.**
   > *Everyone's perspective.*

   It repeats on every section: "Not just for weddings. / *For everything
   worth sharing.*", "One event. One payment. / *No surprises.*". It needs a
   component, not ad-hoc markup.
3. **Full-bleed colour blocks.** Sections alternate canvas → navy → warm
   sand, edge to edge. Content is not a row of cards floating on one
   background; the background itself changes to mark the section.

## Colour

The reference is cream / forest green / copper. We render the same layout in
the **brand navy and mint** instead, on the reference's **warm ground** — the
combination compared side by side as option C before it was chosen.

Two findings from that comparison are worth keeping written down:

- **The structure is what reads expensive, not the hues.** Sharp corners, the
  two-font headline, the arch and full-bleed colour blocks survive the palette
  swap intact. Nothing below depends on the reference's green.
- **The warmth lives in the paper.** Running the same layout on `smoke`
  (`#F4F6F5`) made the alternate section read as a disabled state rather than
  a deliberate band. Swapping only the two neutrals recovers almost all of it
  while the logo, navy and mint stay exactly as they are.

Navy is also the better fit for the pitch. Deep green is a wedding and
hospitality cue; navy is a trust cue, which is what a product whose promise is
*Easy. Beautiful. Private.* is actually selling — and it keeps the site from
reading wedding-exclusive.

| Token | Value | Use |
| --- | --- | --- |
| `canvas` | `#FAF8F4` | Page background. The warm off-white that replaces `smoke` |
| `sand` | `#F0EBE3` | Alternate section background, a shade warmer and deeper |
| `ink` | `#123851` | **Existing brand navy.** Inverted sections, primary buttons, the Plus pricing card |
| `night` | `#0B2536` | **Existing.** Hover state for anything `ink` |
| `charcoal` | `#152833` | Headlines and body. Near-black with a navy cast, never pure `#000`. Named `charcoal` rather than `ink` because `ink` is the navy |
| `mint` | `#7AD8C0` | **Existing brand mint.** Eyebrows, numerals and badges *on navy* |
| `pine` | `#0B7A52` | Eyebrows, numerals and badges *on canvas or sand* |
| `sage` | `#DCEAE4` | Soft circles behind step icons, muted media placeholders |
| `paper` | `#FFFFFF` | Pricing cards and panels that need to lift off `canvas` |

Text on `ink` is `canvas`, not white — the warmth carries through (11.6:1).

**Why two greens.** `accent` (`#099361`) is 3.3:1 on `canvas`, which is fine as
a fill behind white text and a contrast failure for an 11px tracked-out
eyebrow. `pine` is the same green darkened until small text clears AA (5.0:1).
`accent` keeps its existing job; `pine` exists for type. On navy neither works
— both go muddy — so `mint` carries accent text there (7.3:1).

Measured, on `canvas`: `charcoal` 14.3:1, `charcoal/70` body 5.6:1, `pine`
5.0:1. On `ink`: `canvas` 11.6:1, `canvas/75` body 7.2:1, `mint` 7.3:1.

## Type

Two families. Three would cost more in page weight than it returns.

| Role | Family | Weight | Notes |
| --- | --- | --- | --- |
| Display sans | **Poppins** | 700 / 800 | Headline line one. Tight tracking, roughly `-0.02em` |
| Display serif | **Playfair Display** | 400–500 *italic* | Headline line two, occasion labels, big numerals |
| Body / UI | **Poppins** | 400 / 500 | Same family as the display sans, lighter weight |

Eyebrows: uppercase, ~11–12px, letter-spacing ~`0.18em`, `pine` on light
grounds and `mint` on navy.

Serif italic also carries the **numerals** — "847 memories shared", the
`01 / 02 / 03` step numbers — which is a nice detail worth keeping.

## Shape and depth

- **Radius: 0.** One exception, the **arch** (a rounded top on the hero image),
  which is the only decorative shape in the system.
- **Shadows: almost none.** The reference separates things with background
  colour and hairlines, not elevation. Where a card needs to lift off `canvas`
  it goes `paper` white with a 1px `charcoal/10` border.
- Step icons sit in ~56px `sage` circles with a thin line glyph.

## Components Phase 2 builds

Buttons (solid navy / solid canvas / outline), inputs, section wrapper with a
background variant, the two-line heading, eyebrow, pricing card, occasion tile,
stat card, step row, badge, empty state, modal.

## Open questions

**Photography.** The reference uses real event photography and it is doing most
of the work. Note that even the prototype has gaps — the "Graduations" tile is
a grey gradient with no image. Every image reference goes behind
`lib/imagery.ts` so licensed assets drop in without touching layout.

**Fidelity of the font guesses.** Poppins and Playfair Display are close
matches read off screenshots, not confirmed from the prototype's CSS. If the
real stack is available, swapping it is a one-line change in the config
because nothing references a family name directly.
