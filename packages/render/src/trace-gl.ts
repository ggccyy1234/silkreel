import { makeCam, norm, project, sampleShot } from '@silk-reel/choreo'
import type { Cam, TraceTimeline } from '@silk-reel/choreo'
import { createMaps, drawMaps, partDrop } from './trace-maps'
import type { MapSet, Region } from './trace-maps'

/**
 * The lit trace renderer. The board is a physical plate on a dark studio
 * floor under a real perspective camera: copper has sharp shoulders and a
 * metal's reflection, mask is a glossy dielectric that pours on, silk is
 * matte ink, the finish is the board's own gold or tin, and the parts are
 * bodies with weight. Energy is the only thing above white, so it is the
 * only thing that blooms.
 *
 * Per frame: draw board-space data maps (trace-maps) for the region the
 * camera sees → render floor, stack, board and parts into an HDR buffer per
 * motion-blur subframe → depth of field → bloom + lens streak → grade.
 */
export interface Annotation {
  /** anchor (the thing labelled) and label position, frame px */
  ax: number; ay: number; lx: number; ly: number
  text: string
  sub?: string | undefined
  alpha: number
  align: 'left' | 'right'
}

export interface TraceGL {
  render(tl: TraceTimeline, frame: number): HTMLCanvasElement
  /** the captions of the last rendered frame, in screen space */
  annotations(): Annotation[]
  dispose(): void
}

export interface TraceQuality {
  /** motion-blur samples per frame */
  subframes: number
  /** data-map resolution, × the frame */
  mapScale: number
}

const VS_PLANE = `#version 300 es
uniform mat4 uVP; uniform vec4 uRegion; uniform float uZ;
out vec2 vUv; out vec3 vW;
void main(){
  vec2 c = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
  vec2 p = uRegion.xy + uRegion.zw * c;
  vUv = c;
  vW = vec3(p.x, -p.y, uZ);
  gl_Position = uVP * vec4(vW, 1.0);
}`

const LIGHTING = `
uniform vec3 uCam; uniform vec3 uKey; uniform vec3 uKeyCol; uniform vec3 uFill;
uniform vec3 uRim; uniform vec3 uRimCol;
uniform vec3 uBoxN; uniform float uBoxPos; uniform float uBoxGain;
const float PI = 3.14159265;
float sq(float x){ return x * x; }
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
vec3 envLight(vec3 R, float rough){
  float w = 0.05 + rough * 0.55;
  float d = dot(R, uBoxN) - uBoxPos;
  float box = exp(-d * d / (w * w)) * smoothstep(-0.15, 0.35, R.z) * (0.09 / w);
  // a cool studio sky above, black below, and a long overhead strip light:
  // big metal (pours, planes, cans) needs something bright to reflect
  vec3 sky = vec3(0.010, 0.013, 0.018) + vec3(0.02, 0.026, 0.034) * smoothstep(-0.2, 1.0, R.z);
  float strip = exp(-sq((R.x * 0.8 + R.y * 0.6) / (0.22 + rough * 0.5))) * smoothstep(0.35, 0.85, R.z);
  return sky + vec3(0.2, 0.22, 0.25) * strip + uKeyCol * box * uBoxGain;
}
float ggx(vec3 N, vec3 V, vec3 L, float rough){
  vec3 H = normalize(L + V);
  float NoL = max(dot(N, L), 0.0), NoV = max(dot(N, V), 1e-3), NoH = max(dot(N, H), 0.0);
  float a = max(rough * rough, 0.003); float a2 = a * a;
  float dd = NoH * NoH * (a2 - 1.0) + 1.0; float D = a2 / (PI * dd * dd);
  float k = a * 0.5; float Vis = 0.25 / ((NoL * (1.0 - k) + k) * (NoV * (1.0 - k) + k));
  return D * Vis * NoL;
}
vec3 shade(vec3 N, vec3 V, vec3 albedo, float metal, float rough, float f0d){
  vec3 L = normalize(uKey);
  float NoL = max(dot(N, L), 0.0), NoV = max(dot(N, V), 1e-3);
  vec3 f0 = mix(vec3(f0d), albedo, metal);
  vec3 H = normalize(L + V);
  vec3 F = f0 + (1.0 - f0) * pow(1.0 - max(dot(V, H), 0.0), 5.0);
  vec3 spec = ggx(N, V, L, rough) * F * uKeyCol;
  // the rim: a cool light from behind that only catches edges and bevels
  vec3 Lr = normalize(uRim);
  vec3 Fr = f0 + (1.0 - f0) * pow(1.0 - NoV, 5.0);
  vec3 rim = ggx(N, V, Lr, max(rough, 0.18)) * Fr * uRimCol * smoothstep(0.02, 0.35, 1.0 - N.z);
  vec3 diff = albedo * (1.0 - metal) * (NoL * uKeyCol + uFill) / PI * 2.0;
  vec3 refl = envLight(reflect(-V, N), rough) * mix(Fr, albedo * 0.9 + 0.1, metal);
  return diff + spec + rim + refl;
}`

const FS_TOP = `#version 300 es
precision highp float;
in vec2 vUv; in vec3 vW; out vec4 o;
uniform sampler2D tTop; uniform sampler2D tSurf; uniform sampler2D tFx; uniform vec2 uTexel;
uniform vec3 uCopper; uniform vec3 uFinish; uniform vec3 uMask; uniform vec3 uSub; uniform vec3 uSilk;
uniform vec3 uWarm; uniform vec3 uCool;
uniform float uFinishRough; uniform float uMaskFront; uniform float uMaskSoft; uniform float uMaskOn; uniform float uMaskLuma;
uniform float uCure; uniform float uCured;
uniform float uSubAlpha; uniform float uEnergy; uniform float uSlam; uniform float uPxPerMm; uniform float uBump;
uniform vec2 uSweepDir; uniform vec3 uSweep; // (position px along dir, half-width px, gain)
${LIGHTING}
float hcu(vec2 uv, float lod){ return smoothstep(0.2, 0.8, textureLod(tTop, uv, lod).r); }
vec2 gradH(float s, float lod){
  vec2 dx = vec2(uTexel.x * s, 0.0), dy = vec2(0.0, uTexel.y * s);
  return vec2(hcu(vUv + dx, lod) - hcu(vUv - dx, lod), hcu(vUv + dy, lod) - hcu(vUv - dy, lod));
}
vec2 gradC(sampler2D t, int ch, float s, float lod){
  vec2 dx = vec2(uTexel.x * s, 0.0), dy = vec2(0.0, uTexel.y * s);
  return vec2(textureLod(t, vUv + dx, lod)[ch] - textureLod(t, vUv - dx, lod)[ch],
              textureLod(t, vUv + dy, lod)[ch] - textureLod(t, vUv - dy, lod)[ch]);
}
void main(){
  if (vUv.x < 0.0 || vUv.y < 0.0 || vUv.x > 1.0 || vUv.y > 1.0) discard;
  vec4 a = texture(tTop, vUv); vec4 s = texture(tSurf, vUv); vec4 fx = texture(tFx, vUv);
  float cu = a.r, pad = a.g, warm = a.b, silk = s.r, hole = s.g, area = s.b, cool = fx.r, shadow = fx.g;
  if (area < 0.002 && cu < 0.002 && warm < 0.002 && cool < 0.002) discard;
  vec3 V = normalize(uCam - vW);
  vec2 mm = vec2(vW.x, -vW.y) / uPxPerMm;
  // sharp shoulders, flat tops: a fine gradient for the edge, a broad one for the bevel
  vec2 g = (gradH(0.9, 0.0) * 0.75 + gradH(2.5, 1.2) * 0.35) * uBump;
  vec2 gs = gradC(tSurf, 0, 1.2, 0.3) * uBump * 0.6;
  // brushed copper: fine directional grain and a few scratches
  float grain = vnoise(mm * vec2(70.0, 2.5)) - 0.5;
  float scratch = smoothstep(0.92, 1.0, vnoise(mm * vec2(4.0, 140.0)));
  vec3 Ncu = normalize(vec3(-g.x + grain * 0.04, g.y, 1.0));
  float weave = 0.5 + 0.5 * sin(mm.x * 11.0) * sin(mm.y * 11.0 + 1.3);
  vec3 subAlb = uSub * (0.8 + 0.35 * weave);
  vec3 baseSub = shade(vec3(0, 0, 1), V, subAlb, 0.0, 0.6, 0.04);
  float ox = vnoise(mm * 0.7) * 0.6 + vnoise(mm * 3.1) * 0.4;
  vec3 baseCu = shade(Ncu, V, uCopper * (0.86 + 0.24 * ox), 1.0, 0.2 + 0.1 * ox + 0.12 * scratch, 0.04);
  vec3 basePad = shade(Ncu, V, uFinish * (0.9 + 0.08 * ox), 1.0, max(uFinishRough, 0.22), 0.04);
  vec3 col = mix(baseSub, baseCu, cu);
  col = mix(col, basePad, pad);
  // the mask pours down the board: a wet front, then a glossy coat that cures to satin.
  // it clears every pad by a lip, and follows the copper relief beneath
  float py = -vW.y;
  float padNear = textureLod(tTop, vUv, 1.4).g;
  float clearance = smoothstep(0.04, 0.22, padNear);
  float poured = smoothstep(uMaskFront, uMaskFront - uMaskSoft * 0.3, py);
  float masked = uMaskOn * poured * (1.0 - max(pad, clearance)) * (1.0 - hole);
  float wet = uMaskOn * exp(-sq((py - (uMaskFront - uMaskSoft * 0.22)) / (uMaskSoft * 0.14)));
  vec2 lip = gradC(tTop, 1, 2.0, 1.4) * uBump * 0.8 * uMaskOn;
  // under the coat the relief softens: traces read as gentle ridges, not engraved lines
  vec3 Nm = normalize(vec3(-g.x * 0.28 + lip.x, g.y * 0.28 - lip.y + wet * 0.35, 1.0));
  // dark masks read lighter over copper, white mask warms a touch
  float lift = mix(1.45, 1.03, uMaskLuma);
  float sink = mix(0.78, 0.95, uMaskLuma);
  vec3 maskAlb = mix(uMask * sink, min(uMask * lift + uCopper * mix(0.05, 0.02, uMaskLuma), vec3(0.82)), cu);
  vec3 maskC = shade(Nm, V, maskAlb, 0.0, mix(0.05, mix(0.11, 0.16, uCured), 1.0 - wet), 0.05);
  col = mix(col, maskC, masked);
  vec3 Ns = normalize(vec3(-gs.x, gs.y, 1.0));
  col = mix(col, shade(Ns, V, uSilk, 0.0, 0.7, 0.04), silk * (0.4 + 0.6 * poured * uMaskOn));
  col = mix(col, vec3(0.0015), hole * (1.0 - pad));
  // parts shade the board around their bodies
  col *= 1.0 - 0.8 * clamp(shadow, 0.0, 1.0);
  // light: the only thing brighter than white. warm for power, cool for data
  col += uWarm * pow(warm, 1.4) * uEnergy + uCool * pow(cool, 1.4) * uEnergy * 1.15;
  // the slam: a white-hot rim on every copper edge for a few frames
  col += mix(uWarm, vec3(1.0), 0.5) * uSlam * clamp(length(g) * 3.0, 0.0, 1.0) * 3.0;
  // UV cure: a violet pass hardens the coat
  float cureBand = exp(-sq((py - uCure) / (uMaskSoft * 0.5))) * step(0.0, uCure);
  col += vec3(0.42, 0.26, 0.95) * cureBand * masked * 0.4;
  // the hero light: a band passing across, caught by every glossy surface
  float band = exp(-sq((dot(vec2(vW.x, py), uSweepDir) - uSweep.x) / uSweep.y)) * uSweep.z;
  float gloss = 0.1 * masked * (0.4 + cu) + max(cu * (1.0 - masked), 0.6 * pad) + 0.08 * silk;
  col += vec3(1.0, 0.96, 0.9) * band * gloss * area;
  float alpha = clamp(max(area * uSubAlpha * (1.0 - hole * (1.0 - pad)), max(max(cu, pad), max(warm, cool))), 0.0, 1.0);
  o = vec4(col * alpha, alpha);
}`

const FS_LAYER = `#version 300 es
precision highp float;
in vec2 vUv; in vec3 vW; out vec4 o;
uniform sampler2D tStack; uniform sampler2D tStackE; uniform vec2 uTexel; uniform int uCh;
uniform vec3 uCopper; uniform vec3 uCool; uniform float uEnergy; uniform float uAlpha; uniform float uBump; uniform float uSlam;
${LIGHTING}
void main(){
  if (vUv.x < 0.0 || vUv.y < 0.0 || vUv.x > 1.0 || vUv.y > 1.0) discard;
  float cu = texture(tStack, vUv)[uCh]; float en = texture(tStackE, vUv)[uCh];
  if (cu < 0.003 && en < 0.003) discard;
  vec2 dx = vec2(uTexel.x * 1.2, 0.0), dy = vec2(0.0, uTexel.y * 1.2);
  vec2 g = vec2(textureLod(tStack, vUv + dx, 0.4)[uCh] - textureLod(tStack, vUv - dx, 0.4)[uCh],
                textureLod(tStack, vUv + dy, 0.4)[uCh] - textureLod(tStack, vUv - dy, 0.4)[uCh]) * uBump;
  vec3 V = normalize(uCam - vW);
  // traces are solid copper; planes (drawn faint) are a translucent film
  float solid = smoothstep(0.45, 0.85, cu);
  vec3 col = shade(normalize(vec3(-g.x, g.y, 1.0)), V, uCopper * 0.92, 1.0, mix(0.4, 0.24, solid), 0.04);
  col += uCopper * mix(0.03, 0.08, solid);
  col += uCool * pow(en, 1.4) * uEnergy;
  col += vec3(1.0) * uSlam * clamp(length(g) * 3.0, 0.0, 1.0) * 2.0;
  float a = clamp(max(mix(cu * 0.55, cu, solid), en) * uAlpha, 0.0, 1.0);
  o = vec4(col * a, a);
}`

const FS_GLASS = `#version 300 es
precision highp float;
in vec2 vUv; in vec3 vW; out vec4 o;
uniform sampler2D tSurf; uniform vec3 uSub; uniform vec3 uCool; uniform float uAlpha;
void main(){
  if (vUv.x < 0.0 || vUv.y < 0.0 || vUv.x > 1.0 || vUv.y > 1.0) discard;
  float area = texture(tSurf, vUv).b;
  float blur = textureLod(tSurf, vUv, 3.0).b;
  float rim = clamp(abs(area - blur) * 3.0, 0.0, 1.0);
  float a = (area * 0.14 + rim * 0.35) * uAlpha;
  if (a < 0.002) discard;
  vec3 col = uSub * 0.5 + uCool * rim * 0.25;
  o = vec4(col * a, a);
}`

const FS_FLOOR = `#version 300 es
precision highp float;
in vec2 vUv; in vec3 vW; out vec4 o;
uniform sampler2D tSurf; uniform sampler2D tTop; uniform sampler2D tFx; uniform vec4 uMap;
uniform vec2 uCentre; uniform float uSpread; uniform vec3 uWarm; uniform vec3 uCool; uniform vec3 uKeyDir;
uniform float uShock; uniform float uShockR; uniform float uLift;
float sq(float x){ return x * x; }
void main(){
  vec2 p = vec2(vW.x, -vW.y);
  float d = length(p - uCentre);
  // a pool of studio light falling off into black
  vec3 col = vec3(0.012, 0.014, 0.018) * exp(-d * d / (2.0 * uSpread * uSpread)) + vec3(0.0015);
  vec2 uv = (p - uMap.xy) / uMap.zw;
  vec2 suv = uv + uKeyDir.xy * vec2(1.0, -1.0) * (0.006 + uLift * 0.02);
  if (suv.x > 0.0 && suv.y > 0.0 && suv.x < 1.0 && suv.y < 1.0) {
    // the board's contact shadow, softer as the stack lifts off
    float sh = textureLod(tSurf, suv, mix(4.5, 6.5, uLift)).b;
    col *= 1.0 - 0.92 * clamp(sh * 1.3, 0.0, 1.0);
  }
  if (uv.x > 0.0 && uv.y > 0.0 && uv.x < 1.0 && uv.y < 1.0) {
    // energy spills onto the floor around the board
    col += uWarm * textureLod(tTop, uv, 6.5).b * 0.35 + uCool * textureLod(tFx, uv, 6.5).r * 0.45;
  }
  // the slam's shockwave rolls out across the floor
  col += mix(uCool, vec3(1.0), 0.4) * uShock * exp(-sq((d - uShockR) / (uSpread * 0.45))) * 0.05;
  o = vec4(col, 1.0);
}`

const VS_WALL = `#version 300 es
in vec4 aWall; // plane x, plane y, height fraction (0 top .. 1 bottom), outward normal angle
uniform mat4 uVP; uniform float uThick; uniform float uZ;
out vec3 vW; out vec3 vN; out float vF;
void main(){
  vW = vec3(aWall.x, -aWall.y, uZ - aWall.z * uThick);
  vN = vec3(cos(aWall.w), -sin(aWall.w), 0.0);
  vF = aWall.z;
  gl_Position = uVP * vec4(vW, 1.0);
}`

const FS_WALL = `#version 300 es
precision highp float;
in vec3 vW; in vec3 vN; in float vF; out vec4 o;
uniform vec3 uSub; uniform vec3 uCopper; uniform vec3 uMask; uniform float uLayers; uniform float uMaskOn;
${LIGHTING}
void main(){
  vec3 V = normalize(uCam - vW);
  vec3 N = dot(vN, V) < 0.0 ? -vN : vN;
  // the cross-section: laminate with a copper line at every layer, mask on both faces
  float band = 0.0;
  for (float i = 0.0; i < 6.0; i += 1.0) {
    if (i >= uLayers) break;
    float li = uLayers > 1.0 ? i / (uLayers - 1.0) : 0.0;
    band = max(band, exp(-sq((vF - li) / 0.03)));
  }
  float fibre = 0.5 + 0.5 * sin(vF * 70.0);
  vec3 lam = shade(N, V, uSub * (1.2 + 0.4 * fibre), 0.0, 0.7, 0.04);
  vec3 cu = shade(N, V, uCopper, 1.0, 0.3, 0.04);
  vec3 col = mix(lam, cu, band);
  float face = uMaskOn * max(smoothstep(0.06, 0.0, vF), smoothstep(0.94, 1.0, vF));
  col = mix(col, shade(N, V, uMask, 0.0, 0.15, 0.05), face);
  o = vec4(col, 1.0);
}`

const VS_PART = `#version 300 es
in vec4 aBox;   // plane x, y, w, h
in vec4 aMeta;  // rot, height px, kind, landing time
in vec4 aLabel; // atlas cell (col,row), has label, hero
uniform mat4 uVP; uniform float uP; uniform float uBase; uniform float uLift;
out vec3 vW; out vec3 vN; out vec3 vL; flat out vec4 vMeta; flat out vec4 vLabel; flat out vec2 vSize;
const vec3 C[8] = vec3[8](vec3(-.5,-.5,0), vec3(.5,-.5,0), vec3(.5,.5,0), vec3(-.5,.5,0),
                          vec3(-.5,-.5,1), vec3(.5,-.5,1), vec3(.5,.5,1), vec3(-.5,.5,1));
const int I[36] = int[36](4,5,6, 4,6,7, 0,2,1, 0,3,2, 0,1,5, 0,5,4, 1,2,6, 1,6,5, 2,3,7, 2,7,6, 3,0,4, 3,4,7);
const vec3 FN[6] = vec3[6](vec3(0,0,1), vec3(0,0,-1), vec3(0,-1,0), vec3(1,0,0), vec3(0,1,0), vec3(-1,0,0));
float drop(float t, float p, float hero){
  float dur = hero > 0.5 ? 0.032 : 0.014;
  float u = (p - (t - dur)) / dur;
  if (u <= 0.0) return 1.0;
  if (u >= 1.0) return 0.0;
  return 1.0 - u * u;
}
void main(){
  vec3 c = C[I[gl_VertexID]];
  vec3 n = FN[gl_VertexID / 6];
  float dr = drop(aMeta.w, uP, aLabel.w);
  float hidden = step(0.999, dr);
  // landed parts settle with a small bounce; the hero falls from higher
  float since = uP - aMeta.w;
  float bounce = since > 0.0 ? 0.06 * sin(since * 900.0) * exp(-since * 260.0) : 0.0;
  // the hero starts in frame, hovering; everything else drops from just above
  float fall = dr * aMeta.y * (aLabel.w > 0.5 ? 5.0 : 9.0) + abs(bounce) * aMeta.y;
  float cr = cos(aMeta.x), sr = sin(aMeta.x);
  vec2 lp = vec2(c.x * aBox.z, c.y * aBox.w);
  vec2 pp = aBox.xy + vec2(lp.x * cr - lp.y * sr, lp.x * sr + lp.y * cr);
  vW = vec3(pp.x, -pp.y, uBase + uLift + fall + c.z * aMeta.y);
  vec2 nn = vec2(n.x * cr - n.y * sr, n.x * sr + n.y * cr);
  vN = vec3(nn.x, -nn.y, n.z);
  vL = c;
  vMeta = aMeta;
  vLabel = aLabel;
  vSize = aBox.zw;
  gl_Position = hidden > 0.5 ? vec4(2.0, 2.0, 2.0, 1.0) : uVP * vec4(vW, 1.0);
}`

const FS_PART = `#version 300 es
precision highp float;
in vec3 vW; in vec3 vN; in vec3 vL; flat in vec4 vMeta; flat in vec4 vLabel; flat in vec2 vSize; out vec4 o;
uniform sampler2D tAtlas; uniform vec2 uCell; uniform vec3 uFinish; uniform vec3 uWarm; uniform float uLedOn;
${LIGHTING}
void main(){
  vec3 V = normalize(uCam - vW);
  int kind = int(vMeta.z + 0.5);
  vec3 N = normalize(vN);
  // softened edges: bend the normal toward the nearest edge so every box catches a rim
  vec2 e = abs(vL.xy) * 2.0;
  float edge = smoothstep(0.86, 1.0, max(e.x, e.y));
  float top = step(0.5, vN.z);
  if (top > 0.5) {
    vec2 dirL = vec2(e.x > e.y ? sign(vL.x) : 0.0, e.x > e.y ? 0.0 : sign(vL.y));
    float cr = cos(vMeta.x), sr = sin(vMeta.x);
    vec2 dw = vec2(dirL.x * cr - dirL.y * sr, dirL.x * sr + dirL.y * cr);
    N = normalize(N + vec3(dw.x, -dw.y, 0.0) * edge * 0.9);
  }
  vec3 alb = vec3(0.022); float metal = 0.0; float rough = 0.42; vec3 emit = vec3(0.0);
  float along = vSize.x >= vSize.y ? vL.x : vL.y;
  float cap = smoothstep(0.34, 0.37, abs(along));
  if (kind == 0) {            // ic: black epoxy, a pin-1 dimple, a laser-etched marking
    alb = vec3(0.028, 0.028, 0.03); rough = 0.5;
    if (top > 0.5) {
      vec2 q = vL.xy + 0.5;
      float dimple = 1.0 - smoothstep(0.035, 0.05, length((q - vec2(0.13, 0.13)) * vSize / max(vSize.x, vSize.y)));
      alb = mix(alb, vec3(0.012), dimple); rough = mix(rough, 0.2, dimple);
      if (vLabel.z > 0.5) {
        // the marking runs along the long side, at the atlas cell's 4:1 aspect
        bool wide = vSize.x >= vSize.y;
        vec2 t = wide ? q : vec2(q.y, 1.0 - q.x);
        float longS = max(vSize.x, vSize.y), shortS = min(vSize.x, vSize.y);
        float hFrac = min(0.5, 0.78 * longS / 4.0 / shortS);
        float wFrac = hFrac * shortS * 4.0 / longS;
        vec2 tc = vec2((t.x - 0.5) / wFrac + 0.5, (t.y - 0.5) / hFrac + 0.5);
        if (vLabel.z > 1.5) tc = 1.0 - tc;
        if (tc.x > 0.0 && tc.x < 1.0 && tc.y > 0.0 && tc.y < 1.0) {
          float m = texture(tAtlas, (vLabel.xy + tc) * uCell).r;
          alb = mix(alb, vec3(0.16, 0.16, 0.165), m); rough = mix(rough, 0.75, m);
        }
      }
    }
  } else if (kind == 1) {     // resistor: black top, white ceramic sides, tin ends
    alb = top > 0.5 ? vec3(0.02) : vec3(0.55, 0.53, 0.5); rough = 0.55;
    alb = mix(alb, uFinish * 0.9 + 0.1, cap); metal = cap; rough = mix(rough, 0.3, cap);
  } else if (kind == 2) {     // MLCC: tan ceramic, tin ends
    alb = vec3(0.33, 0.24, 0.15); rough = 0.6;
    alb = mix(alb, uFinish * 0.9 + 0.1, cap); metal = cap; rough = mix(rough, 0.3, cap);
  } else if (kind == 3) {     // inductor
    alb = vec3(0.05, 0.05, 0.055); rough = 0.5;
    alb = mix(alb, uFinish * 0.9 + 0.1, cap); metal = cap;
  } else if (kind == 4) {     // diode: black with a silver cathode band
    alb = vec3(0.025); rough = 0.45;
    float band = smoothstep(0.24, 0.27, along) * (1.0 - smoothstep(0.33, 0.36, along));
    alb = mix(alb, vec3(0.5), band);
  } else if (kind == 5) {     // LED: milky lens that lights in the hero
    alb = vec3(0.7, 0.7, 0.66); rough = 0.2;
    emit = uWarm * uLedOn * 0.45 * (0.5 + 0.5 * top);
  } else if (kind == 6) {     // crystal: a metal can
    alb = vec3(0.72, 0.73, 0.75); metal = 1.0; rough = 0.22;
  } else if (kind == 7) {     // connector: black plastic, a grid of gold pins on top
    alb = vec3(0.03, 0.03, 0.032); rough = 0.55;
    if (top > 0.5 && vLabel.z > 0.5) {
      vec2 lpx = vL.xy * vSize;
      vec2 cell = abs(fract(lpx / vLabel.z + 0.5) - 0.5) * 2.0;
      float pin = (1.0 - smoothstep(0.32, 0.4, max(cell.x, cell.y))) * step(max(abs(vL.x) * vSize.x - vSize.x * 0.5 + vLabel.z * 0.5, abs(vL.y) * vSize.y - vSize.y * 0.5 + vLabel.z * 0.5), 0.0);
      alb = mix(alb, uFinish * 0.85 + vec3(0.05, 0.04, 0.0), pin); metal = pin; rough = mix(rough, 0.25, pin);
    }
  } else if (kind == 8) {     // switch: steel cap on a black base
    alb = top > 0.5 ? vec3(0.62, 0.63, 0.65) : vec3(0.03); metal = top; rough = 0.3;
  } else if (kind == 9) {     // electrolytic: aluminium top, dark sleeve
    alb = top > 0.5 ? vec3(0.7, 0.71, 0.72) : vec3(0.02, 0.04, 0.12); metal = top; rough = top > 0.5 ? 0.28 : 0.35;
  } else {
    alb = vec3(0.05, 0.05, 0.055); rough = 0.5;
  }
  vec3 col = shade(N, V, alb, metal, rough, 0.045) + emit;
  // the underside hugs the board: ambient occlusion at the foot of every wall
  col *= mix(0.45, 1.0, smoothstep(0.0, 0.35, vL.z));
  o = vec4(col, 1.0);
}`

const VS_VIA = `#version 300 es
in vec3 aVia; // plane x, plane y, radius px
uniform mat4 uVP; uniform vec3 uRight; uniform float uZTop; uniform float uZBot;
out float vU; out float vV; flat out float vSeed; flat out float vAlong;
uniform vec4 uExt;
void main(){
  float u = float(gl_VertexID & 1), v = float(gl_VertexID >> 1);
  vU = u; vV = v;
  vSeed = fract(sin(dot(aVia.xy, vec2(12.9898, 78.233))) * 43758.5453);
  vAlong = clamp(((aVia.x - uExt.x) / uExt.z) * 0.7 + ((aVia.y - uExt.y) / uExt.w) * 0.3, 0.0, 1.0);
  vec3 w = vec3(aVia.x, -aVia.y, mix(uZBot, uZTop, v)) + uRight * (u - 0.5) * max(aVia.z * 1.6, 2.0);
  gl_Position = uVP * vec4(w, 1.0);
}`

const FS_VIA = `#version 300 es
precision highp float;
in float vU; in float vV; flat in float vSeed; flat in float vAlong; out vec4 o;
uniform vec3 uCool; uniform float uGlow; uniform float uWave;
float sq(float x){ return x * x; }
void main(){
  float core = pow(1.0 - abs(vU * 2.0 - 1.0), 3.0);
  // traffic: a wave crosses the board and, as it passes each via, a bead of
  // light drops through the stack from the top layer to the bottom
  float lit = step(0.45, vSeed);
  float ph = (uWave - vAlong * 0.7) * 1.6;
  float bead = lit * step(0.0, ph) * step(ph, 1.0) * exp(-sq((1.0 - vV) - ph) / 0.006);
  o = vec4(uCool * core * uGlow * (0.02 + 2.4 * bead), 0.0);
}`

const VS_QUAD = `#version 300 es
out vec2 uv;
void main(){ vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); uv = p; gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`

const FS_COPY = `#version 300 es
precision highp float; in vec2 uv; out vec4 o; uniform sampler2D t; uniform float uW;
void main(){ o = texture(t, uv) * uW; }`

const FS_DOF = `#version 300 es
precision highp float; in vec2 uv; out vec4 o;
uniform sampler2D t; uniform vec2 uRes;
uniform vec3 uCam; uniform vec3 uF; uniform vec3 uR; uniform vec3 uU; uniform vec2 uTan;
uniform float uFocus; uniform float uAperture; uniform float uMaxR;
float coc(vec2 q){
  vec2 n = q * 2.0 - 1.0;
  vec3 d = normalize(uF + uR * n.x * uTan.x + uU * n.y * uTan.y);
  float z = d.z < -1e-4 ? (-uCam.z / d.z) * dot(d, uF) : 1e6;
  return clamp(abs(1.0 - uFocus / z) * uAperture, 0.0, uMaxR);
}
void main(){
  float c = coc(uv);
  if (c < 0.5) { o = texture(t, uv); return; }
  vec4 acc = vec4(0.0); float wsum = 0.0;
  const int N = 48;
  for (int i = 0; i < N; i++) {
    float fi = float(i) + 0.5;
    float r = sqrt(fi / float(N)) * c;
    float a = fi * 2.39996;
    vec2 q = uv + vec2(cos(a), sin(a)) * r / uRes;
    vec4 s = texture(t, q);
    // highlights dominate their disc and its rim: real bokeh, not gaussian mush
    float l = max(s.r, max(s.g, s.b));
    float w = smoothstep(r - 1.5, r + 0.5, coc(q) + 1.0) * (1.0 + 3.0 * smoothstep(1.2, 4.0, l)) * (1.0 + 0.6 * smoothstep(0.6, 1.0, r / c));
    acc += s * w; wsum += w;
  }
  o = acc / max(wsum, 1e-3);
}`

const FS_BRIGHT = `#version 300 es
precision highp float; in vec2 uv; out vec4 o; uniform sampler2D t;
void main(){ vec3 c = texture(t, uv).rgb; float l = max(c.r, max(c.g, c.b));
  float k = smoothstep(1.6, 3.4, l); o = vec4(c * k, 1.0); }`

const FS_DOWN = `#version 300 es
precision highp float; in vec2 uv; out vec4 o; uniform sampler2D t; uniform vec2 h;
void main(){ vec4 s = texture(t, uv) * 4.0;
  s += texture(t, uv - h) + texture(t, uv + h) + texture(t, uv + vec2(h.x, -h.y)) + texture(t, uv - vec2(h.x, -h.y));
  o = s / 8.0; }`

const FS_UP = `#version 300 es
precision highp float; in vec2 uv; out vec4 o; uniform sampler2D t; uniform vec2 h;
void main(){ vec4 s = texture(t, uv + vec2(-h.x * 2.0, 0.0)) + texture(t, uv + vec2(h.x * 2.0, 0.0))
  + texture(t, uv + vec2(0.0, -h.y * 2.0)) + texture(t, uv + vec2(0.0, h.y * 2.0));
  s += (texture(t, uv + vec2(-h.x, h.y)) + texture(t, uv + h) + texture(t, uv + vec2(h.x, -h.y)) + texture(t, uv - h)) * 2.0;
  o = s / 12.0; }`

const FS_STREAK = `#version 300 es
precision highp float; in vec2 uv; out vec4 o; uniform sampler2D t; uniform vec2 uStep;
void main(){ vec4 s = vec4(0.0); float ws = 0.0;
  for (int i = -4; i <= 4; i++) { float w = exp(-float(i * i) / 8.0); s += texture(t, uv + uStep * float(i)) * w; ws += w; }
  o = s / ws * 0.98; }`

const FS_FINAL = `#version 300 es
precision highp float; in vec2 uv; out vec4 o;
uniform sampler2D tCol; uniform sampler2D tBloom; uniform sampler2D tStreak;
uniform float uBloom; uniform float uStreak; uniform vec3 uStreakTint; uniform float uExposure; uniform float uCA;
uniform vec3 uBg; uniform float uFrame; uniform bool uGrain; uniform bool uTransparent; uniform float uVignette;
vec3 aces(vec3 x){ return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main(){
  vec2 d = uv - 0.5;
  vec4 base = texture(tCol, uv);
  vec3 c = vec3(texture(tCol, uv - d * uCA).r, base.g, texture(tCol, uv + d * uCA).b);
  vec3 glow = texture(tBloom, uv).rgb * uBloom + texture(tStreak, uv).rgb * uStreak * uStreakTint;
  c += glow;
  c = aces(c * uExposure);
  // a gentle toe keeps the blacks black and the mids open
  c = pow(c, vec3(1.0 / 2.2));
  c = smoothstep(0.0, 1.0, c * 0.96 + 0.02) * 0.92 + c * 0.08;
  float a = 1.0;
  if (uTransparent) {
    a = clamp(base.a + dot(glow, vec3(0.3)), 0.0, 1.0);
  } else {
    c += uBg * (1.0 - clamp(base.a, 0.0, 1.0));
    c *= mix(1.0, smoothstep(1.25, 0.3, length(d) * 1.45), uVignette);
    if (uGrain) c += (hash(gl_FragCoord.xy + uFrame * 17.0) - 0.5) * (2.5 / 255.0);
  }
  o = vec4(c * (uTransparent ? a : 1.0), a);
}`

type GL = WebGL2RenderingContext

interface Target { tex: WebGLTexture; fbo: WebGLFramebuffer; w: number; h: number }

function compile(gl: GL, type: number, src: string): WebGLShader | undefined {
  const sh = gl.createShader(type)
  if (sh === null) return undefined
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (gl.getShaderParameter(sh, gl.COMPILE_STATUS) !== true) {
    // eslint-disable-next-line no-console
    console.warn(`trace-gl shader: ${gl.getShaderInfoLog(sh) ?? 'compile failed'}`)
    return undefined
  }
  return sh
}

class Prog {
  private readonly loc = new Map<string, WebGLUniformLocation | null>()
  constructor(private readonly gl: GL, readonly p: WebGLProgram) {}
  use(): this {
    this.gl.useProgram(this.p)
    return this
  }
  private u(name: string): WebGLUniformLocation | null {
    let l = this.loc.get(name)
    if (l === undefined) {
      l = this.gl.getUniformLocation(this.p, name)
      this.loc.set(name, l)
    }
    return l
  }
  f(name: string, ...v: number[]): this {
    const l = this.u(name)
    if (v.length === 1) this.gl.uniform1f(l, v[0] as number)
    else if (v.length === 2) this.gl.uniform2f(l, v[0] as number, v[1] as number)
    else if (v.length === 3) this.gl.uniform3f(l, v[0] as number, v[1] as number, v[2] as number)
    else this.gl.uniform4f(l, v[0] as number, v[1] as number, v[2] as number, v[3] as number)
    return this
  }
  v3(name: string, v: readonly number[]): this {
    return this.f(name, v[0] as number, v[1] as number, v[2] as number)
  }
  i(name: string, v: number): this {
    this.gl.uniform1i(this.u(name), v)
    return this
  }
  m4(name: string, m: Float32Array): this {
    this.gl.uniformMatrix4fv(this.u(name), false, m)
    return this
  }
}

function link(gl: GL, vs: string, fs: string): Prog | undefined {
  const v = compile(gl, gl.VERTEX_SHADER, vs)
  const f = compile(gl, gl.FRAGMENT_SHADER, fs)
  if (v === undefined || f === undefined) return undefined
  const p = gl.createProgram() as WebGLProgram | null
  if (p === null) return undefined
  gl.attachShader(p, v)
  gl.attachShader(p, f)
  gl.linkProgram(p)
  gl.deleteShader(v)
  gl.deleteShader(f)
  if (gl.getProgramParameter(p, gl.LINK_STATUS) !== true) {
    // eslint-disable-next-line no-console
    console.warn(`trace-gl link: ${gl.getProgramInfoLog(p) ?? 'link failed'}`)
    return undefined
  }
  return new Prog(gl, p)
}

/** #rrggbb → linear RGB */
export function linear(hex: string): [number, number, number] {
  const c = (i: number): number => Math.pow(Number.parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) / 255, 2.2)
  return [c(0), c(1), c(2)]
}

/** where the camera's view meets the plane z = zPlane, as a plane-px bbox */
function footprint(cam: Cam, zPlane: number): Region {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const d = norm([
        cam.f[0] + cam.r[0] * sx * cam.tanX + cam.u[0] * sy * cam.tanY,
        cam.f[1] + cam.r[1] * sx * cam.tanX + cam.u[1] * sy * cam.tanY,
        cam.f[2] + cam.r[2] * sx * cam.tanX + cam.u[2] * sy * cam.tanY
      ])
      // rays near the horizon clamp to a far reach instead of infinity
      const t = d[2] < -0.05 ? (zPlane - cam.pos[2]) / d[2] : cam.dist * 6
      const x = cam.pos[0] + d[0] * t
      const y = -(cam.pos[1] + d[1] * t)
      x0 = Math.min(x0, x)
      y0 = Math.min(y0, y)
      x1 = Math.max(x1, x)
      y1 = Math.max(y1, y)
    }
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

const KIND_ID: Record<string, number> = { ic: 0, res: 1, cap: 2, ind: 3, diode: 4, led: 5, xtal: 6, conn: 7, switch: 8, can: 9, other: 10 }

const ease = (x: number): number => {
  const t = Math.min(1, Math.max(0, x))
  return t * t * (3 - 2 * t)
}
const backOut = (x: number): number => {
  const t = Math.min(1, Math.max(0, x)) - 1
  return 1 + t * t * (2.4 * t + 1.4)
}

/**
 * Each layer's lift (0 rest .. 1 full) through the stack act: a cascade off
 * the top, a spring settle, a float, an anticipation rise, an accelerating
 * fall and a small rebound after impact.
 */
export function layerLift(p: number, i: number, n: number, ex: [number, number], slam: [number, number]): number {
  const stagger = 0.007
  const dur = ex[1] - ex[0] - stagger * Math.max(0, n - 1)
  let e = backOut((p - ex[0] - i * stagger) / Math.max(0.01, dur))
  if (p < ex[0]) return 0
  if (p > ex[1] && p < slam[0]) e += 0.015 * Math.sin((p - ex[1]) * 90 + i * 1.7)
  const pre = 0.014
  if (p >= slam[0] - pre && p < slam[0]) e *= 1 + 0.08 * ease((p - (slam[0] - pre)) / pre)
  if (p >= slam[0]) {
    const u = Math.min(1, (p - slam[0]) / (slam[1] - slam[0]))
    e = 1.08 * (1 - Math.pow(u, 2.2))
    if (u >= 1) {
      const t = p - slam[1]
      e = Math.max(0, 0.03 * Math.sin(t * 700) * Math.exp(-t * 320))
    }
  }
  return Math.max(0, e)
}

export function createTraceGL(width: number, height: number, quality: TraceQuality): TraceGL | undefined {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  let gl: GL | null = null
  try {
    gl = canvas.getContext('webgl2', { premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: false, alpha: true })
  } catch {
    return undefined
  }
  if (gl === null) return undefined
  const g = gl
  const hdr = g.getExtension('EXT_color_buffer_float') !== null
  const aniso = g.getExtension('EXT_texture_filter_anisotropic')

  const progs = {
    top: link(g, VS_PLANE, FS_TOP),
    layer: link(g, VS_PLANE, FS_LAYER),
    glass: link(g, VS_PLANE, FS_GLASS),
    floor: link(g, VS_PLANE, FS_FLOOR),
    wall: link(g, VS_WALL, FS_WALL),
    part: link(g, VS_PART, FS_PART),
    via: link(g, VS_VIA, FS_VIA),
    copy: link(g, VS_QUAD, FS_COPY),
    dof: link(g, VS_QUAD, FS_DOF),
    bright: link(g, VS_QUAD, FS_BRIGHT),
    down: link(g, VS_QUAD, FS_DOWN),
    up: link(g, VS_QUAD, FS_UP),
    streak: link(g, VS_QUAD, FS_STREAK),
    final: link(g, VS_QUAD, FS_FINAL)
  }
  if (Object.values(progs).some((p) => p === undefined)) return undefined
  const P = progs as { [K in keyof typeof progs]: Prog }

  const vao = g.createVertexArray()
  g.bindVertexArray(vao)
  g.pixelStorei(g.UNPACK_COLORSPACE_CONVERSION_WEBGL, g.NONE)
  g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)

  const k = Math.min(quality.mapScale, 4096 / Math.max(width, height))
  const MW = Math.round(width * k)
  const MH = Math.round(height * k)
  const maps: MapSet = createMaps(MW, MH)
  const mkTex = (mip: boolean): WebGLTexture => {
    const t = g.createTexture()
    g.bindTexture(g.TEXTURE_2D, t)
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, mip ? g.LINEAR_MIPMAP_LINEAR : g.LINEAR)
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR)
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE)
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE)
    if (mip && aniso !== null) g.texParameterf(g.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, 8)
    return t
  }
  // top, surf, fx, stack, stackE, atlas
  const mapTex = [0, 1, 2, 3, 4].map(() => mkTex(true))
  const atlasTex = mkTex(true)

  const target = (w: number, h: number, depth: boolean): Target => {
    const tex = g.createTexture()
    g.bindTexture(g.TEXTURE_2D, tex)
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR)
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR)
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE)
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE)
    g.texImage2D(g.TEXTURE_2D, 0, hdr ? g.RGBA16F : g.RGBA8, w, h, 0, g.RGBA, hdr ? g.HALF_FLOAT : g.UNSIGNED_BYTE, null)
    const fbo = g.createFramebuffer()
    g.bindFramebuffer(g.FRAMEBUFFER, fbo)
    g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, tex, 0)
    if (depth) {
      const rb = g.createRenderbuffer()
      g.bindRenderbuffer(g.RENDERBUFFER, rb)
      g.renderbufferStorage(g.RENDERBUFFER, g.DEPTH_COMPONENT24, w, h)
      g.framebufferRenderbuffer(g.FRAMEBUFFER, g.DEPTH_ATTACHMENT, g.RENDERBUFFER, rb)
    }
    return { tex, fbo, w, h }
  }
  const scene = target(width, height, true)
  const accum = target(width, height, true)
  const dof = target(width, height, false)
  const pyramid: Target[] = []
  for (let i = 0, w = Math.ceil(width / 2), h = Math.ceil(height / 2); i < 6; i++, w = Math.max(1, w >> 1), h = Math.max(1, h >> 1)) pyramid.push(target(w, h, false))
  const sw = Math.ceil(width / 4)
  const sh = Math.ceil(height / 4)
  const streakA = target(sw, sh, false)
  const streakB = target(sw, sh, false)

  const bind = (t: Target | null): void => {
    g.bindFramebuffer(g.FRAMEBUFFER, t?.fbo ?? null)
    g.viewport(0, 0, t?.w ?? width, t?.h ?? height)
  }
  const tex = (unit: number, t: WebGLTexture): void => {
    g.activeTexture(g.TEXTURE0 + unit)
    g.bindTexture(g.TEXTURE_2D, t)
  }
  const quad = (): void => {
    g.drawArrays(g.TRIANGLES, 0, 3)
  }

  // per-timeline geometry: board walls, vias, parts and their markings
  let builtFor: TraceTimeline | undefined
  const wallBuf = g.createBuffer()
  const viaBuf = g.createBuffer()
  const partBuf = g.createBuffer()
  let wallCount = 0
  let viaCount = 0
  let partCount = 0
  let extent: Region = { x: 0, y: 0, w: width, h: height }
  const CELL_W = 256
  const CELL_H = 64
  const ATLAS_COLS = 8
  const ATLAS_ROWS = 16
  const build = (tl: TraceTimeline): void => {
    if (builtFor === tl) return
    builtFor = tl
    const s = tl.scene
    const walls: number[] = []
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (const loop of s.board) {
      const n = loop.length / 2
      for (let i = 0; i < n; i++) {
        const ax = loop[i * 2] as number
        const ay = loop[i * 2 + 1] as number
        const bx = loop[((i + 1) % n) * 2] as number
        const by = loop[((i + 1) % n) * 2 + 1] as number
        x0 = Math.min(x0, ax)
        y0 = Math.min(y0, ay)
        x1 = Math.max(x1, ax)
        y1 = Math.max(y1, ay)
        if (Math.hypot(bx - ax, by - ay) < 1e-6) continue
        const ang = Math.atan2(bx - ax, -(by - ay))
        walls.push(ax, ay, 0, ang, bx, by, 0, ang, ax, ay, 1, ang, bx, by, 0, ang, bx, by, 1, ang, ax, ay, 1, ang)
      }
    }
    const m = 0.06 * Math.max(x1 - x0, y1 - y0)
    extent = Number.isFinite(x0) ? { x: x0 - m, y: y0 - m, w: x1 - x0 + 2 * m, h: y1 - y0 + 2 * m } : { x: 0, y: 0, w: width, h: height }
    g.bindBuffer(g.ARRAY_BUFFER, wallBuf)
    g.bufferData(g.ARRAY_BUFFER, new Float32Array(walls), g.STATIC_DRAW)
    wallCount = walls.length / 4
    g.bindBuffer(g.ARRAY_BUFFER, viaBuf)
    g.bufferData(g.ARRAY_BUFFER, new Float32Array(s.vias.flatMap((v) => [v.x, v.y, v.r])), g.STATIC_DRAW)
    viaCount = s.vias.length
    // markings: one atlas cell per labelled part
    const atlas = document.createElement('canvas')
    atlas.width = CELL_W * ATLAS_COLS
    atlas.height = CELL_H * ATLAS_ROWS
    const actx = atlas.getContext('2d') as CanvasRenderingContext2D
    actx.fillStyle = '#000'
    actx.fillRect(0, 0, atlas.width, atlas.height)
    actx.fillStyle = '#fff'
    actx.textAlign = 'center'
    actx.textBaseline = 'middle'
    let cell = 0
    const inst: number[] = []
    for (const part of s.parts) {
      let col = 0
      let row = 0
      let has = 0
      if (part.label !== undefined && cell < ATLAS_COLS * ATLAS_ROWS) {
        col = cell % ATLAS_COLS
        row = Math.floor(cell / ATLAS_COLS)
        const size = Math.min(34, (CELL_W * 0.92) / Math.max(1, part.label.length) * 1.7)
        actx.font = `600 ${size}px ui-monospace, Menlo, monospace`
        actx.fillText(part.label, col * CELL_W + CELL_W / 2, row * CELL_H + CELL_H / 2)
        // a marking reads left to right across the frame: flip it if its baseline runs backwards
        const dirX = part.w >= part.h ? Math.cos(part.rot) : -Math.sin(part.rot)
        has = dirX < -0.01 ? 2 : 1
        cell++
      }
      // connectors carry their pin pitch where ICs carry their marking flag
      const third = part.kind === 'conn' ? (part.pitch ?? 0) : has
      inst.push(part.x, part.y, part.w, part.h, part.rot, part.z, KIND_ID[part.kind] ?? 10, part.t, col, row, third, part.hero === true ? 1 : 0)
    }
    g.bindTexture(g.TEXTURE_2D, atlasTex)
    g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, atlas)
    g.generateMipmap(g.TEXTURE_2D)
    g.bindBuffer(g.ARRAY_BUFFER, partBuf)
    g.bufferData(g.ARRAY_BUFFER, new Float32Array(inst), g.STATIC_DRAW)
    partCount = s.parts.length
  }

  /** the region to rasterise: what the camera sees of the board (both stack ends) */
  const regionFor = (cam: Cam, zs: number[]): Region => {
    let r: Region | undefined
    for (const z of zs) {
      const f = footprint(cam, z)
      if (r === undefined) r = f
      else {
        const xa = Math.min(r.x, f.x)
        const ya = Math.min(r.y, f.y)
        r = { x: xa, y: ya, w: Math.max(r.x + r.w, f.x + f.w) - xa, h: Math.max(r.y + r.h, f.y + f.h) - ya }
      }
    }
    const f = r as Region
    const xa = Math.max(f.x, extent.x)
    const ya = Math.max(f.y, extent.y)
    const xb = Math.min(f.x + f.w, extent.x + extent.w)
    const yb = Math.min(f.y + f.h, extent.y + extent.h)
    let w = Math.max(8, xb - xa)
    let h = Math.max(8, yb - ya)
    const aspect = MW / MH
    let x = xa
    let y = ya
    if (w / h > aspect) {
      const nh = w / aspect
      y -= (nh - h) / 2
      h = nh
    } else {
      const nw = h * aspect
      x -= (nw - w) / 2
      w = nw
    }
    return { x, y, w, h }
  }

  const upload = (i: number, c: HTMLCanvasElement): void => {
    g.bindTexture(g.TEXTURE_2D, mapTex[i] as WebGLTexture)
    g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, c)
    g.generateMipmap(g.TEXTURE_2D)
  }

  const lighting = (prog: Prog, cam: Cam, p: number, sweep: number): void => {
    // a warm key raking low across the board, a cool rim from behind the camera's line
    const az = -2.35 + p * 1.1
    const el = 0.52
    const back = norm([-cam.f[0], -cam.f[1], 0])
    prog.v3('uCam', cam.pos)
      .f('uKey', Math.cos(az) * Math.cos(el), Math.sin(az) * Math.cos(el), Math.sin(el))
      .f('uKeyCol', 3.0, 2.72, 2.35)
      .f('uFill', 0.03, 0.045, 0.07)
      .f('uRim', -back[0] * 0.9, -back[1] * 0.9, 0.42)
      .f('uRimCol', 1.3, 1.65, 2.2)
      .f('uBoxN', 0.6, -0.8, 0)
      .f('uBoxPos', -0.9 + Math.min(1, Math.max(0, sweep)) * 1.8)
      .f('uBoxGain', 0.38)
  }

  let lastAnnotations: Annotation[] = []

  return {
    annotations: () => lastAnnotations,
    render(tl: TraceTimeline, frame: number): HTMLCanvasElement {
      if (g.isContextLost()) return canvas
      build(tl)
      const s = tl.scene
      const W = width
      const H = height
      const p = frame / tl.totalFrames
      const acts = s.acts
      const span = (a: [number, number]): number => ease((p - a[0]) / (a[1] - a[0]))
      const nLayers = Math.max(1, s.layers.length)
      const lifts = Array.from({ length: nLayers }, (_, i) => layerLift(p, i, nLayers, acts.explode, acts.slam))
      const explode = Math.max(...lifts)
      // the stack rises off the bottom layer: the top climbs highest
      const zOf = (i: number): number => s.stack.gap * (lifts[i] as number) * (nLayers - 1 - i)
      const sinceSlam = p - acts.slam[1]
      const slam = sinceSlam >= 0 ? Math.exp(-sinceSlam * 260) : 0
      const fade = 1 - span([0.975, 1])
      const sweep = (p - acts.sweep[0]) / (acts.sweep[1] - acts.sweep[0])
      const minWH = Math.min(W, H)

      const shake = (q: number): { dx: number; dy: number } => {
        const t = q - acts.slam[1]
        if (t < 0) return { dx: 0, dy: 0 }
        const amp = Math.exp(-t * 55) * 0.009 * minWH
        return { dx: amp * Math.sin(t * 900), dy: amp * Math.cos(t * 1130) }
      }
      const camAt = (q: number): Cam => {
        const shot = sampleShot(s.shots, q)
        const sh = shake(q)
        return makeCam({ ...shot, x: shot.x + sh.dx, y: shot.y + sh.dy }, W, H)
      }
      const cam = camAt(p)
      const withStack = explode > 0.001
      const region = regionFor(cam, withStack ? [zOf(0), 0] : [0])
      drawMaps(maps, tl, p, region, withStack)
      upload(0, maps.top)
      upload(1, maps.surf)
      upload(2, maps.fx)
      if (withStack) {
        upload(3, maps.stack)
        upload(4, maps.stackE)
      }

      const pal = tl.palette
      const m = s.material
      const warmC = linear(m.energyWarm)
      const coolC = linear(m.energyCool)
      const copper = linear(pal.copper)
      const texel = [1 / MW, 1 / MH] as const
      const regionV = [region.x, region.y, region.w, region.h] as const
      const maskSpan = span(acts.mask)
      const maskOn = p >= acts.mask[0] ? 1 : 0
      const soft = 0.07 * extent.h
      const maskFront = extent.y - soft + maskSpan * (extent.h + 2 * soft)
      const cureU = (p - acts.cure[0]) / (acts.cure[1] - acts.cure[0])
      const cureY = cureU >= 0 && cureU <= 1 ? extent.y - soft + cureU * (extent.h + 2 * soft) : -1e9
      const maskLin = linear(m.mask)
      const maskLuma = 0.2126 * maskLin[0] + 0.7152 * maskLin[1] + 0.0722 * maskLin[2]
      const energyGain = 3.2
      const sweepDir = norm([1, 0.55, 0])
      const corners = [[extent.x, extent.y], [extent.x + extent.w, extent.y], [extent.x, extent.y + extent.h], [extent.x + extent.w, extent.y + extent.h]]
        .map(([x, y]) => (x as number) * sweepDir[0] + (y as number) * sweepDir[1])
      const sLo = Math.min(...corners)
      const sHi = Math.max(...corners)
      const sweepW = 0.05 * (sHi - sLo)
      const sweepV = [sLo - sweepW * 2 + Math.min(1, Math.max(0, sweep)) * (sHi - sLo + sweepW * 4), sweepW, sweep > 0 && sweep < 1 ? 0.32 : 0] as const
      const centre = { x: extent.x + extent.w / 2, y: extent.y + extent.h / 2 }
      const diag = Math.hypot(extent.w, extent.h)
      const floorZ = -Math.max(1.5, m.thicknessPx * 1.4) - 0.5
      const keyAz = -2.35 + p * 1.1

      const drawScene = (c: Cam): void => {
        g.enable(g.BLEND)
        g.blendFunc(g.ONE, g.ONE_MINUS_SRC_ALPHA)
        g.clearColor(0, 0, 0, 0)
        g.clearDepth(1)
        // clear respects the depth mask: open it, or last frame's depth survives
        g.depthMask(true)
        g.clear(g.COLOR_BUFFER_BIT | g.DEPTH_BUFFER_BIT)
        g.disable(g.DEPTH_TEST)
        g.depthMask(false)
        g.bindVertexArray(vao)
        // the studio floor: light pool, contact shadow, spill and shockwave
        if (!tl.transparent) {
          tex(0, mapTex[1] as WebGLTexture)
          tex(1, mapTex[0] as WebGLTexture)
          tex(2, mapTex[2] as WebGLTexture)
          const fr = diag * 3
          P.floor.use().m4('uVP', c.vp).f('uRegion', centre.x - fr, centre.y - fr, fr * 2, fr * 2).f('uZ', floorZ)
            .i('tSurf', 0).i('tTop', 1).i('tFx', 2).f('uMap', ...regionV).f('uCentre', centre.x, centre.y).f('uSpread', diag * 0.75)
            .v3('uWarm', warmC).v3('uCool', coolC).f('uKeyDir', Math.cos(keyAz), Math.sin(keyAz), 0)
            .f('uShock', slam > 0.001 ? Math.exp(-sinceSlam * 40) : 0).f('uShockR', diag * 0.45 + sinceSlam * diag * 9).f('uLift', explode)
          g.drawArrays(g.TRIANGLE_STRIP, 0, 4)
        }
        if (withStack) {
          // bottom of the stack first; glass sheets between the copper layers
          for (let i = nLayers - 1; i >= 1; i--) {
            const ch = lowerChannel(s, i)
            tex(0, mapTex[3] as WebGLTexture)
            tex(1, mapTex[4] as WebGLTexture)
            P.layer.use().m4('uVP', c.vp).f('uRegion', ...regionV).f('uZ', zOf(i)).i('tStack', 0).i('tStackE', 1)
              .f('uTexel', ...texel).i('uCh', ch).v3('uCopper', copper).v3('uCool', coolC).f('uEnergy', energyGain)
              .f('uAlpha', Math.min(1, explode * 3)).f('uBump', 1.4).f('uSlam', slam)
            lighting(P.layer, c, p, sweep)
            g.drawArrays(g.TRIANGLE_STRIP, 0, 4)
            tex(0, mapTex[1] as WebGLTexture)
            P.glass.use().m4('uVP', c.vp).f('uRegion', ...regionV).f('uZ', (zOf(i) + zOf(i - 1)) / 2).i('tSurf', 0)
              .v3('uSub', linear(m.substrate)).v3('uCool', coolC).f('uAlpha', explode)
            g.drawArrays(g.TRIANGLE_STRIP, 0, 4)
          }
          if (viaCount > 0) {
            // vias stand up as light between the layers; traffic drops through them
            g.blendFunc(g.ONE, g.ONE)
            g.bindBuffer(g.ARRAY_BUFFER, viaBuf)
            const loc = g.getAttribLocation(P.via.p, 'aVia')
            g.enableVertexAttribArray(loc)
            g.vertexAttribPointer(loc, 3, g.FLOAT, false, 0, 0)
            g.vertexAttribDivisor(loc, 1)
            P.via.use().m4('uVP', c.vp).v3('uRight', c.r).f('uZTop', zOf(0)).f('uZBot', zOf(nLayers - 1))
              .v3('uCool', coolC).f('uGlow', explode).f('uWave', (p - acts.explode[1]) / (acts.slam[0] - acts.explode[1]))
              .f('uExt', extent.x, extent.y, extent.w, extent.h)
            g.drawArraysInstanced(g.TRIANGLE_STRIP, 0, 4, viaCount)
            g.vertexAttribDivisor(loc, 0)
            g.disableVertexAttribArray(loc)
            g.blendFunc(g.ONE, g.ONE_MINUS_SRC_ALPHA)
          }
        } else if (wallCount > 0) {
          // the board's edge: laminate with a copper line per layer
          g.enable(g.DEPTH_TEST)
          g.depthMask(true)
          g.bindBuffer(g.ARRAY_BUFFER, wallBuf)
          const loc = g.getAttribLocation(P.wall.p, 'aWall')
          g.enableVertexAttribArray(loc)
          g.vertexAttribPointer(loc, 4, g.FLOAT, false, 0, 0)
          P.wall.use().m4('uVP', c.vp).f('uThick', Math.max(1.5, m.thicknessPx * 1.4)).f('uZ', 0)
            .v3('uSub', linear(m.substrate)).v3('uCopper', copper).v3('uMask', maskLin).f('uLayers', nLayers).f('uMaskOn', span(acts.mask))
          lighting(P.wall, c, p, sweep)
          g.drawArrays(g.TRIANGLES, 0, wallCount)
          g.disableVertexAttribArray(loc)
        }
        g.enable(g.DEPTH_TEST)
        g.depthFunc(g.LEQUAL)
        g.depthMask(true)
        tex(0, mapTex[0] as WebGLTexture)
        tex(1, mapTex[1] as WebGLTexture)
        tex(2, mapTex[2] as WebGLTexture)
        P.top.use().m4('uVP', c.vp).f('uRegion', ...regionV).f('uZ', zOf(0)).i('tTop', 0).i('tSurf', 1).i('tFx', 2)
          .f('uTexel', ...texel).v3('uCopper', copper).v3('uFinish', linear(m.finish)).v3('uMask', maskLin)
          .v3('uSub', linear(m.substrate)).v3('uSilk', linear(m.silk)).v3('uWarm', warmC).v3('uCool', coolC)
          .f('uFinishRough', m.finishRough).f('uMaskFront', maskFront).f('uMaskSoft', soft).f('uMaskOn', maskOn).f('uMaskLuma', Math.pow(maskLuma, 1 / 2.2))
          .f('uCure', cureY).f('uCured', p >= acts.cure[1] ? 1 : 0)
          .f('uSubAlpha', 1 - explode * 0.88).f('uEnergy', energyGain).f('uSlam', slam).f('uPxPerMm', m.pxPerMm).f('uBump', 1.6)
          .f('uSweepDir', sweepDir[0], sweepDir[1]).f('uSweep', ...sweepV)
        lighting(P.top, c, p, sweep)
        g.drawArrays(g.TRIANGLE_STRIP, 0, 4)
        if (partCount > 0) {
          // bodies: opaque, depth-tested, riding the top layer (and lifting above it in the stack)
          g.disable(g.BLEND)
          g.bindBuffer(g.ARRAY_BUFFER, partBuf)
          const stride = 12 * 4
          const locs = ['aBox', 'aMeta', 'aLabel'].map((n) => g.getAttribLocation(P.part.p, n))
          locs.forEach((loc, i) => {
            g.enableVertexAttribArray(loc)
            g.vertexAttribPointer(loc, 4, g.FLOAT, false, stride, i * 16)
            g.vertexAttribDivisor(loc, 1)
          })
          tex(0, atlasTex)
          P.part.use().m4('uVP', c.vp).f('uP', p).f('uBase', zOf(0)).f('uLift', s.stack.gap * explode * 0.7)
            .i('tAtlas', 0).f('uCell', 1 / ATLAS_COLS, 1 / ATLAS_ROWS).v3('uFinish', linear(m.finish)).v3('uWarm', warmC)
            .f('uLedOn', span([acts.place[1], acts.place[1] + 0.03]))
          lighting(P.part, c, p, sweep)
          g.drawArraysInstanced(g.TRIANGLES, 0, 36, partCount)
          for (const loc of locs) {
            g.vertexAttribDivisor(loc, 0)
            g.disableVertexAttribArray(loc)
          }
          g.enable(g.BLEND)
        }
        g.disable(g.DEPTH_TEST)
        g.depthMask(false)
      }

      // motion blur: the camera samples a 180° shutter; maps hold per frame
      const n = Math.max(1, quality.subframes)
      const shutter = 0.5 / tl.totalFrames
      if (n === 1) {
        bind(accum)
        drawScene(cam)
      } else {
        bind(accum)
        g.clearColor(0, 0, 0, 0)
        g.clear(g.COLOR_BUFFER_BIT)
        for (let i = 0; i < n; i++) {
          bind(scene)
          drawScene(camAt(p + ((i + 0.5) / n - 0.5) * shutter))
          bind(accum)
          g.enable(g.BLEND)
          g.blendFunc(g.ONE, g.ONE)
          tex(0, scene.tex)
          P.copy.use().i('t', 0).f('uW', 1 / n)
          quad()
        }
      }
      g.disable(g.BLEND)

      // depth of field focused on the look-at point
      bind(dof)
      tex(0, accum.tex)
      P.dof.use().i('t', 0).f('uRes', W, H).v3('uCam', cam.pos).v3('uF', cam.f).v3('uR', cam.r).v3('uU', cam.u)
        .f('uTan', cam.tanX, cam.tanY).f('uFocus', cam.dist).f('uAperture', cam.aperture * 0.045 * H).f('uMaxR', 0.022 * H)
      quad()

      // bloom pyramid on what's above white, and a horizontal streak
      bind(pyramid[0] as Target)
      tex(0, dof.tex)
      P.bright.use().i('t', 0)
      quad()
      for (let i = 1; i < pyramid.length; i++) {
        const src = pyramid[i - 1] as Target
        bind(pyramid[i] as Target)
        tex(0, src.tex)
        P.down.use().i('t', 0).f('h', 0.5 / src.w, 0.5 / src.h)
        quad()
      }
      bind(streakA)
      tex(0, (pyramid[0] as Target).tex)
      P.copy.use().i('t', 0).f('uW', 1)
      quad()
      let sa = streakA
      let sb = streakB
      for (const step of [1, 2.5, 6]) {
        bind(sb)
        tex(0, sa.tex)
        P.streak.use().i('t', 0).f('uStep', step / sw, 0)
        quad()
        ;[sa, sb] = [sb, sa]
      }
      g.enable(g.BLEND)
      g.blendFunc(g.ONE, g.ONE)
      for (let i = pyramid.length - 1; i > 0; i--) {
        const src = pyramid[i] as Target
        bind(pyramid[i - 1] as Target)
        tex(0, src.tex)
        P.up.use().i('t', 0).f('h', 0.5 / src.w, 0.5 / src.h)
        quad()
      }
      g.disable(g.BLEND)

      bind(null)
      tex(0, dof.tex)
      tex(1, (pyramid[0] as Target).tex)
      tex(2, sa.tex)
      const bg = tl.transparent ? [0, 0, 0] : linear(pal.bg).map((v) => Math.pow(v, 1 / 2.2))
      P.final.use().i('tCol', 0).i('tBloom', 1).i('tStreak', 2)
        .f('uBloom', 0.7 * pal.bloom + 0.2).f('uStreak', 0.12).v3('uStreakTint', coolC)
        .f('uExposure', 1.32 * fade).f('uCA', 0.0012).f('uFrame', frame).i('uGrain', tl.transparent ? 0 : 1)
        .i('uTransparent', tl.transparent ? 1 : 0).v3('uBg', bg).f('uVignette', 0.32)
      g.clearColor(0, 0, 0, 0)
      g.clear(g.COLOR_BUFFER_BIT)
      quad()
      g.finish()

      lastAnnotations = annotate(tl, cam, p, zOf, nLayers, explode, extent, fade)
      return canvas
    },
    dispose(): void {
      g.getExtension('WEBGL_lose_context')?.loseContext()
    }
  }
}

/**
 * Screen-space captions: the hero part as it lands, the lead unit where it
 * arrives, and each layer's name while the stack hangs apart.
 */
function annotate(
  tl: TraceTimeline, cam: Cam, p: number, zOf: (i: number) => number, n: number, explode: number, ext: Region, fade: number
): Annotation[] {
  const W = tl.width
  const H = tl.height
  const s = tl.scene
  const out: Annotation[] = []
  const toPx = (x: number, y: number, z: number): { x: number; y: number; ok: boolean } => {
    const q = project(cam, x, y, z)
    return { x: (q.x * 0.5 + 0.5) * W, y: (1 - (q.y * 0.5 + 0.5)) * H, ok: q.w > 0 && Math.abs(q.x) < 1.1 && Math.abs(q.y) < 1.1 }
  }
  const lead = 0.06 * Math.min(W, H)
  for (const c of s.callouts) {
    if (p < c.t0 || p > c.t1) continue
    const alpha = Math.min(ease((p - c.t0) / 0.01), ease((c.t1 - p) / 0.012)) * fade
    if (alpha <= 0.01) continue
    // a part's caption hangs off its corner, never across its marking
    const part = s.parts.find((pt) => Math.hypot(pt.x - c.x, pt.y - c.y) < Math.max(pt.w, pt.h) * 0.5)
    const corners = part === undefined
      ? [[c.x, c.y]]
      : [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([sx, sy]) => {
          const lx = (sx as number) * part.w * 0.5
          const ly = (sy as number) * part.h * 0.5
          return [part.x + lx * Math.cos(part.rot) - ly * Math.sin(part.rot), part.y + lx * Math.sin(part.rot) + ly * Math.cos(part.rot)]
        })
    const pts = corners.map(([x, y]) => toPx(x as number, y as number, part?.z ?? 0)).filter((q) => q.ok)
    // anchor on the part's topmost corner; the label rises clear above its whole outline
    const a = [...pts].sort((u, v) => u.y - v.y)[0]
    if (a === undefined) continue
    const y0 = Math.min(...pts.map((q) => q.y))
    const right = a.x < W * 0.6
    const lx = a.x + (right ? lead * 0.5 : -lead * 0.5)
    const ly = Math.max(H * 0.07, y0 - lead * 0.8)
    out.push({ ax: a.x, ay: a.y, lx, ly, text: c.text, sub: c.sub, alpha, align: right ? 'left' : 'right' })
  }
  if (explode > 0.55) {
    const alpha = ease((explode - 0.55) / 0.35) * fade
    for (let i = 0; i < n; i++) {
      const label = s.stack.labels[i]
      if (label === undefined) continue
      // pin each label to the side edge of its layer with room for the words beside it
      const ends = [toPx(ext.x + ext.w * 0.94, ext.y + ext.h * 0.5, zOf(i)), toPx(ext.x + ext.w * 0.06, ext.y + ext.h * 0.5, zOf(i))]
        .filter((q) => q.ok)
        .sort((x, y) => y.x - x.x)
      const r = ends[0]
      const l = ends[ends.length - 1]
      let pick: { a: { x: number; y: number }; dir: 1 | -1 } | undefined
      if (r !== undefined && r.x < W * 0.6) pick = { a: r, dir: 1 }
      else if (l !== undefined && l.x > W * 0.4) pick = { a: l, dir: -1 }
      if (pick === undefined) continue
      out.push({ ax: pick.a.x, ay: pick.a.y, lx: pick.a.x + pick.dir * lead, ly: pick.a.y, text: label, alpha, align: pick.dir > 0 ? 'left' : 'right' })
    }
  }
  return out
}

/**
 * The stack draws layers top (0) to bottom (n-1); layer 0 is the front
 * copper in the top map, the rest live in the stack map's channels — inner
 * layers alternate R/G, the back layer is B.
 */
function lowerChannel(s: TraceTimeline['scene'], idx: number): number {
  const topSide = s.layers.some((l) => l.side === 'F') ? 'F' : (s.layers[s.layers.length - 1]?.side ?? 'F')
  const lower = s.layers.filter((l) => l.side !== topSide)
  const inner = lower.filter((l) => l.side === 'inner')
  const ordered = [...inner, ...lower.filter((l) => l.side !== 'inner')]
  const layer = ordered[idx - 1]
  if (layer === undefined) return 2
  return layer.side === 'B' ? 2 : (inner.indexOf(layer) % 2 === 0 ? 0 : 1)
}

export { partDrop }
