# silk reel: brand

silk reel turns a KiCad board file into a release film of that board. The site is its launch page and its studio. Every change to the site is checked against this page.

## Principles

1. **A drawing of a real board.** The site is a set of engineering drawings of real boards: white line work on blueprint blue, ink on drafting paper. The references are patent drawings, ship spec sheets and wireframe blueprints.
2. **Annotate only what is real.** A callout points at a real part (U4 · FT2232H), a dimension line carries a real measure (68.6 mm, 1920 × 1080), a spec block lists real counts, a figure number names a real figure. A label that points at nothing ("Sheet 2 · Zone A") is decoration and is cut.
3. **Say it once.** No caption that restates the thing beside it, no label on an obvious control, no hint for something that just works (clean-copy ladder).
4. **Plain words in prose.** Engine vocabulary (drawings, beats, acts, hero chip) stays in the code. Part designators and values are fine in a callout: that is what a drawing shows.
5. **One focal point, one primary action per screen.** One filled button a screen.
6. **Motion explains.** Playback, a page change, a state change, a drawing being drawn. Every motion has a reduced-motion still.
7. **Polish over features.** A control that cannot work for a visitor is hidden until it can.

## Voice

Short declarative sentences. Concrete nouns: board, film, frame, command. Second person for actions ("Drop your board"). No exclamation marks, no superlatives, no "simply", no "powerful".

## Type

- **Osifont** (ISO 3098 engineering lettering, LGPL 3 with font exception): headlines, figure numbers, spec labels, callouts, nav. One weight; never faked bold. Labels are uppercase, tracked 0.1em.
- **Archivo** (OFL, variable): everything you read: ledes, body, table text, buttons.
- **JetBrains Mono** (OFL): only what you type: commands, flags, values.
- Scale (tokens.css): mega, xl, l, m, body 16 px, s 14 px, label 13 px.

## Colour

- **Drafting paper** `#ecebe4` with a faint blue grid (`.grid`, only on drawing sheets); ink `#163a78`, muted `#3f5683`.
- **Blueprint blue** `#1d4fa3` (`.pos`) with white line work `#eef3ff`, muted `#c3d3f2`.
- **Redline** `#c4221a` on paper, `#ff8a7d` on blue: only a mark on the current thing (playhead, active link, the frame in the gate, a callout's target). Never text on blue.
- **Black stock** `#0b0b0b` only inside a film frame.

## Line work

- Construction lines 1 px at 18 %, outlines 1 px at 100 %, dimension lines 1 px with open arrowheads and the value centred in Osifont.
- Callouts: a dot on the part, a leader line, a shoulder, the label.
- Radius: 0 on drawings and film frames; 6 px on buttons and inputs, 8 px on panels.

## Motion tokens

| Token | Value | Use |
|---|---|---|
| `--t1` | 120 ms | press, scale 0.97 |
| `--t2` | 200 ms | hover, toggle, colour |
| `--t3` | 320 ms | panel, popover, underline |
| `--t4` | 600 ms | section entrance |
| `--soft` | cubic-bezier(0.25, 1, 0.5, 1) | everything that enters |
| `--out` | cubic-bezier(0.4, 0, 1, 1) | everything that leaves (faster) |
| `--pull` | cubic-bezier(0.77, 0, 0.175, 1) | film advancing a frame only |

Hover: a button's fill deepens (ink to redline) or an outline fills with a 6 % tint; a link draws its underline. No rolling labels on hover; a label rolls only when its value changes (Copy to Copied).

## Components

- Button: `.btn` (outlined) and `.btn--solid` (filled, one a screen), 44 px tall, 38 px in the header.
- Link: `.prose-link`, underline drawn on hover.
- Terminal: `.term`, the command with a copy button.
- Small label: `.silk`, only beside a bare value.

## The loader

On a first visit to home only: the mark draws itself as line work on blueprint blue, a film strip under it fills frame by frame with the real load progress, then the mark lands in the header. Under 2 s, skipped on repeat visits, under reduced motion and on any input.
