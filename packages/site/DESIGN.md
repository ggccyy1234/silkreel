# silk reel site: design

## Brief

- Subject: silk reel turns a KiCad `.kicad_pcb` into a release film of that board. The glyph loop is the product's face.
- Audience: hardware engineers and makers who ship boards and post them.
- Job: a flex page. A visitor should feel the board is real, see it become a film, and leave with the command.
- Bar: a recent.design catalogue entry and a Site of the Year. Closest references: igloo.inc (one object, one continuous camera, almost no UI) and blueprint.io (one signature colour, technical renders, a giant wordmark).

## History

1. Stacked boxed sections with videos (blind critic 6.9; the owner: "mediocre").
2. "The page is a silkscreen": the glyph film full-bleed in every chapter. The owner: much better, but the film is carried around too much, there is clutter, and the colour is boring.
3. The yellow room (below). The owner: the hero and the ascent are "absolutely stellar"; the film section was a letdown and the datasheet unneeded. A magnified, re-printed film was "a false video".
4. Film first: the owner wants to see the film before the dither, and the look to follow how the film is made. Four comps (`.shots/concepts/`); this build combines A (Premiere: the film first, a title card and its beat bar) with D (Edit bay: the film's real score as lanes in the deck).

5. The yellow room was replaced on 2026-10-21 by "A reel" (below), mocked section by section in Paper (file `01M5FP2VMRY3VEA1PNBWVHJCZT`, page 2) before the build. The owner: "hero looks golden". The previous site is archived in `review/site-yellow-room-2026-10-21.tgz`.

6. 2026-10-22, after the owner's review of "A reel" (the third section was confusing, the score section was unclear, the slate and the command looked generic, the crop-corner hover needed rethinking, and the footer wordmark could be better): the three passes became "Two looks", the score became a beat bar under the gate, the slate and the command merged into one command whose words are the controls, every hover became a one-line roll, and the wordmark became an isometric bench figure.

## Concept card: a reel

```
Idea:        the glyph film is real film stock: 168 drawings of one board, wound on a reel
Metaphor:    a cutting room on a lightbox; a strip of 35 mm film, the gate of a viewer, an Academy leader
Signature:   the hero reel, a WebGL spiral of the actual 168 drawings that pays drawings out as you scroll
Emotion:     the first three seconds feel like threading a projector: count down, then the reel
Motion verb: wind and pay out like film; frames step, they never fade
Screenshot:  the coil on the opal lightbox, the red hero frames on the outer turn
```

Every frame on the strip is a real frame of the iCEBreaker glyph film, drawn in the browser by the product's own renderer (`drawGlyphFrame`). The frame numbers are the film's frame numbers (two per drawing), and the beat labels are its 24-beat score.

## Signature moments

1. Countdown: an Academy leader counts 8 down to 2 while the atlas of 168 drawings builds. Its progress is the real build progress, capped at 2.6 s. At the end the countdown lands on the PICTURE START box of the leader. Skipped on repeat visits and under reduced motion.
2. The reel: a fragment shader inverts an Archimedean spiral, so every pixel finds its place on the strip. The coil stays exact at any size. Scroll pays drawings out onto the leader.
3. The gate: a pinned section scrubs the strip through a viewer gate, and a beam projects the frame in the gate onto a screen where the live film plays. Space plays, arrow keys step a frame.
4. Two looks: the trace film (a 16:9 video render, labelled) beside the glyph film drawn live, the same board in both.
5. The beat bar: under the gate, the four acts on the 24-beat score fill as the strip runs.
6. One command: `npm run reel -- icebreaker.kicad_pcb --style glyph --aspect 16:9 --palette mono`. Each word opens a native popover picker (board or your own `.kicad_pcb`, style, aspect, palette), and the monitor above plays the film that line renders. Trace shows its 16:9 render and says so; a dropped board is parsed in a worker and never leaves the tab.
7. Hover: a label rolls up one line, like the strip advancing a frame, and a red frame line passes through; buttons also seat a red tick. One treatment for every button and nav link.
8. The footer bench: "silk reel" as machined letters on a base plate, a film strip threaded over sprocket rollers between reels, and a counter rolling 000 to 335. It comes apart as the footer scrolls in and settles together at the bottom (anatomy kit, `figure/build.mjs`).

## Idle motion (decision)

The hero reel drifts by a fraction of a drawing at rest, so the first screen never settles (`heroSettledMs` is null). This is intended: a reel on a lightbox is a live object. The drift is off under reduced motion and off screen.

## System

- Colour (Lightbox): opal `#ecede9` ground, stock `#0b0b0b`, pencil `#d7261e` for the hero frames and marks. Red text is `#c4221a` on opal and `#ff4a3d` on stock, both checked at 4.5:1. Muted text `#4a4a46`. `.pos` marks a dark-stock section.
- Type: JetBrains Mono (OFL) only, 400 and 500.
- Motion: GSAP with ScrollTrigger and Lenis on one ticker. One fixed WebGL2 canvas for the reel; Canvas2D for the strip, the screens and the stills.
- Under reduced motion: no countdown, no drift, no scrub; the gate shows a held frame, and every section is a still.
- Without WebGL2: the poster images `reel-desk.webp` and `reel-phone.webp` (stills from `reel.py`, the same geometry).

## Assets

- Glyph films: `public/films/glyph/*.json` from `scripts/timelines.mts`.
- Trace films: `public/films/trace/<board>-540.mp4` (and `icebreaker-720.mp4`) with webp posters, rendered by `npm run reel -- … --style trace --aspect 16:9 --no-audio`.
- Footer figure: generated by `node figure/build.mjs` (`--audit` proves the geometry).
- Font: JetBrains Mono (OFL).
- Sound: CC0 recordings in `public/sound/`, off until the visitor turns it on (credits in the footer).
