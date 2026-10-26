# Third-party notices

This fork retains the upstream silkreel Apache-2.0 license. The compact CAD command-line archive bundles the upstream S-expression parser with its CLI; the Apache-2.0 LICENSE is included. Other upstream rendering styles, example boards, sound and fonts are available in the full source repository and retain their existing notices; they are not bundled into the compact CAD runtime.

| Dependency | License / distribution |
| --- | --- |
| Three.js | MIT; installed by npm; its license remains in the dependency |
| esbuild | MIT; installed by npm; its license remains in the dependency |
| Playwright / Playwright Core | Apache-2.0; installed by npm; browsers are separately installed or supplied by the user |
| cadquery-ocp-novtk / OpenCascade | Optional separately installed Python runtime; LGPL-2.1 with OpenCascade exception; see the installed distribution's notices and https://dev.opencascade.org/resources/licensing |
| Pillow | Separately installed Python imaging dependency; HPND / Pillow license; see the installed distribution's LICENSE |
| KiCad / pcbnew | User-installed application/runtime; not redistributed here; see https://www.kicad.org/about/licenses/ |
| Remotion compositor FFmpeg/FFprobe | npm dependency, not included in this ZIP's file payload; follow the installed package's terms and its FFmpeg build license. See https://www.remotion.dev/docs/ffmpeg and https://ffmpeg.org/legal.html. No additional license grant is made by this fork. |
| JLC / LCEDA model service | Optional network model lookup used only at the user's request. JLC model metadata and files are attributed to “嘉立创EDA/EasyEDA官方库” with https://lceda.cn/ and https://easyeda.com. JLC/LCEDA service terms, account restrictions and downloaded model rights apply. No JLC model or component library is redistributed in this project or its release ZIP. |

Node.js, Python, KiCad, browsers, OpenCascade libraries and FFmpeg binaries are not embedded in the compact release ZIP. CAD models and designs belong to their respective rightsholders; the software license does not grant rights to publish a user's designs or third-party component models. The package includes only authored synthetic CAD test fixtures and model references, not KiCad library model files.
