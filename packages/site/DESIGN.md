# silk reel: brand

silk reel turns a KiCad board file into a release film of that board. The site is its launch page and its studio. Every change to the site is checked against this page.

## Principles

1. **Show the film, not the metaphor.** Sprocket holes, gates, strips and frames appear only on things that are film: the hero reel, the gate, the studio monitor and the footer bench. They never decorate a section edge, a label, an eyebrow or a table.
2. **Say it once.** No caption that restates the thing beside it, no label on an obvious control, no hint for something that just works, no copy defending a decision. A string stays only if the visitor cannot act without it (clean-copy ladder).
3. **Plain words.** Public copy never uses the engine's vocabulary: drawings, beats, acts, spine, pillars, hero chip, designators, render API (outside the self-hosting docs), zones, sheets.
4. **One focal point per screen, one primary action per screen.** One filled button a screen; everything else is outlined or a text link.
5. **Motion explains.** It shows playback, a page change or a state change. Nothing moves to prove the page is interactive. Every motion has a reduced-motion still.
6. **Polish over features.** Fewer, finished things. A control that cannot work for a visitor (the local render API) is hidden until it can.

## Voice

Short declarative sentences. Concrete nouns: board, film, frame, command. Second person for actions ("Drop your board"). No exclamation marks, no superlatives, no "simply", no "powerful".

## Type

- **Instrument Sans** (OFL, variable weight and width) speaks: headlines at 600 and width 85 %, body at 400.
- **JetBrains Mono** (OFL) is only for what you type and what the film counts: commands, flags, values, numbers, timecode.
- Scale (tokens.css): mega, xl, l, m, body 16 px, s 14 px, label 13 px. Nothing under 13 px except mono timecode at 12 px.
- No uppercase tracked labels. Sentence case everywhere.

## Colour

- Opal `#ecede9` ground, stock `#0b0b0b` ink and dark sections (`.pos`), one red: `#c4221a` on opal, `#ff4a3d` on stock (both 4.5:1). Muted text `#4a4a46` on opal, `#a9a9a3` on stock.
- Red marks only the current thing: the active nav link, the playhead, the primary button on hover, the hero frame. Never decoration.

## Shape

- Radius: 6 px on buttons and inputs, 8 px on panels and the terminal, 0 on film frames (film has square corners).
- Lines: 1 px at 14 % or 30 % ink. No double rules, no zone grids, no title blocks.

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

Hover: a button's fill deepens (ink to red) or an outline fills with a 6 % tint; a link draws its underline. No rolling labels on hover; a label rolls only when its value changes (Copy to Copied).

## Components

- Button: `.btn` (outlined) and `.btn--solid` (filled, one a screen), 44 px tall, 38 px in the header.
- Link: `.prose-link`, underline drawn on hover.
- Terminal: `.term`, the command with a copy button.
- Small label: `.silk`, only beside a bare value.

## The loader

On a first visit to home only: the mark draws itself on stock, a film strip under it fills frame by frame with the real load progress, then the mark lands in the header. Under 2 s, skipped on repeat visits, under reduced motion and on any input.
