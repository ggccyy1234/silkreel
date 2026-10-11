import type { CameraShot, TraceTimeline } from '@silk-reel/choreo'
import { createMaps, drawMaps } from './trace-maps'
import type { MapSet, Region } from './trace-maps'

/**
 * The lit trace renderer. The board is a physical plate under a real
 * perspective camera: copper has a profile and a metal's reflection, mask
 * is a glossy dielectric over it, silk is matte ink, the finish is the
 * board's own gold or tin. Energy is the only thing above white, so it is
 * the only thing that blooms.
 *
 * Per frame: draw board-space data maps (trace-maps) for the region the
 * camera sees → render planes into an HDR buffer for each motion-blur
 * subframe → depth of field → bloom + lens streak → tone map + grade.
 */
export interface TraceGL {
  render(tl: TraceTimeline, frame: number): HTMLCanvasElement
  dispose(): void
}

const FOV = (30 * Math.PI) / 180

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
uniform vec3 uBoxN; uniform float uBoxPos; uniform float uBoxGain;
const float PI = 3.14159265;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
vec3 envLight(vec3 R, float rough){
  float w = 0.05 + rough * 0.55;
  float d = dot(R, uBoxN) - uBoxPos;
  float box = exp(-d * d / (w * w)) * smoothstep(-0.15, 0.35, R.z) * (0.09 / w);
  float sky = 0.012 + 0.03 * smoothstep(-0.3, 1.0, R.z);
  return vec3(sky) + uKeyCol * box * uBoxGain;
}
vec3 shade(vec3 N, vec3 V, vec3 albedo, float metal, float rough, float f0d){
  vec3 L = normalize(uKey); vec3 H = normalize(L + V);
  float NoL = max(dot(N, L), 0.0), NoV = max(dot(N, V), 1e-3), NoH = max(dot(N, H), 0.0), VoH = max(dot(V, H), 0.0);
  vec3 f0 = mix(vec3(f0d), albedo, metal);
  float a = max(rough * rough, 0.003);
  vec3 F = f0 + (1.0 - f0) * pow(1.0 - VoH, 5.0);
  float a2 = a * a; float dd = NoH * NoH * (a2 - 1.0) + 1.0; float D = a2 / (PI * dd * dd);
  float k = a * 0.5; float Vis = 0.25 / ((NoL * (1.0 - k) + k) * (NoV * (1.0 - k) + k));
  vec3 spec = D * Vis * F * NoL * uKeyCol;
  vec3 diff = albedo * (1.0 - metal) * (NoL * uKeyCol + uFill) / PI * 2.0;
  vec3 Fe = f0 + (1.0 - f0) * pow(1.0 - NoV, 5.0);
  vec3 refl = envLight(reflect(-V, N), rough) * mix(Fe, albedo * 0.9 + 0.1, metal);
  return diff + spec + refl;
}`

const FS_TOP = `#version 300 es
precision highp float;
in vec2 vUv; in vec3 vW; out vec4 o;
uniform sampler2D tTop; uniform sampler2D tSurf; uniform vec2 uTexel;
uniform vec3 uCopper; uniform vec3 uFinish; uniform vec3 uMask; uniform vec3 uSub; uniform vec3 uSilk; uniform vec3 uHead;
uniform float uFinishRough; uniform float uMaskFront; uniform float uMaskSoft; uniform float uMaskOn;
uniform float uSubAlpha; uniform float uEnergy; uniform float uSlam; uniform float uPxPerMm; uniform float uBump;
uniform vec2 uSweepDir; uniform vec3 uSweep; // (position px along dir, half-width px, gain)
${LIGHTING}
vec2 grad(sampler2D t, int ch, float s, float lod){
  vec2 dx = vec2(uTexel.x * s, 0.0), dy = vec2(0.0, uTexel.y * s);
  return vec2(textureLod(t, vUv + dx, lod)[ch] - textureLod(t, vUv - dx, lod)[ch],
              textureLod(t, vUv + dy, lod)[ch] - textureLod(t, vUv - dy, lod)[ch]);
}
void main(){
  if (vUv.x < 0.0 || vUv.y < 0.0 || vUv.x > 1.0 || vUv.y > 1.0) discard;
  vec4 a = texture(tTop, vUv); vec4 s = texture(tSurf, vUv);
  float cu = a.r, pad = a.g, en = a.b, silk = s.r, hole = s.g, area = s.b;
  if (area < 0.002 && cu < 0.002 && en < 0.002) discard;
  vec3 V = normalize(uCam - vW);
  vec2 mm = vec2(vW.x, -vW.y) / uPxPerMm;
  vec2 g = grad(tTop, 0, 1.5, 0.6) * uBump;
  vec2 gs = grad(tSurf, 0, 1.2, 0.3) * uBump * 0.6;
  vec3 Ncu = normalize(vec3(-g.x, g.y, 1.0));
  // laminate: glass weave under resin
  float weave = 0.5 + 0.5 * sin(mm.x * 11.0) * sin(mm.y * 11.0 + 1.3);
  vec3 subAlb = uSub * (0.8 + 0.35 * weave);
  vec3 baseSub = shade(vec3(0, 0, 1), V, subAlb, 0.0, 0.6, 0.04);
  float ox = vnoise(mm * 0.7) * 0.6 + vnoise(mm * 3.1) * 0.4;
  vec3 baseCu = shade(Ncu, V, uCopper * (0.86 + 0.24 * ox), 1.0, 0.22 + 0.12 * ox, 0.04);
  vec3 basePad = shade(Ncu, V, uFinish * (0.95 + 0.08 * ox), 1.0, uFinishRough, 0.04);
  vec3 col = mix(baseSub, baseCu, cu);
  col = mix(col, basePad, pad);
  // mask pours down the board: a glossy coat that follows the copper relief
  float py = -vW.y;
  float masked = uMaskOn * smoothstep(uMaskFront, uMaskFront - uMaskSoft, py) * (1.0 - pad) * (1.0 - hole);
  vec3 Nm = normalize(vec3(-g.x * 0.55, g.y * 0.55, 1.0));
  // mask reads lighter over copper and darker over bare laminate
  vec3 maskAlb = mix(uMask * 0.62, min(uMask * 0.9 + uCopper * 0.06, vec3(0.8)), cu);
  vec3 maskC = shade(Nm, V, maskAlb, 0.0, 0.12, 0.05);
  col = mix(col, maskC, masked);
  vec3 Ns = normalize(vec3(-gs.x, gs.y, 1.0));
  col = mix(col, shade(Ns, V, uSilk, 0.0, 0.7, 0.04), silk);
  col = mix(col, vec3(0.0015), hole * (1.0 - pad));
  // light: the only thing brighter than white
  col += uHead * (pow(en, 1.4) * uEnergy + uSlam * cu * 0.45);
  // the hero light: a band passing across, caught by every glossy surface
  float band = exp(-pow((dot(vec2(vW.x, py), uSweepDir) - uSweep.x) / uSweep.y, 2.0)) * uSweep.z;
  float gloss = 0.1 * masked * (0.4 + cu) + max(cu * (1.0 - masked), 0.6 * pad) + 0.08 * silk;
  col += vec3(1.0, 0.96, 0.9) * band * gloss * area;
  float edge = uMaskOn * exp(-pow((py - uMaskFront) / max(1.0, uMaskSoft * 0.12), 2.0)) * area;
  col += vec3(1.0, 0.98, 0.95) * edge * 0.9;
  float alpha = clamp(max(area * uSubAlpha * (1.0 - hole * (1.0 - pad)), max(max(cu, pad), en)), 0.0, 1.0);
  o = vec4(col * alpha, alpha);
}`

const FS_LAYER = `#version 300 es
precision highp float;
in vec2 vUv; in vec3 vW; out vec4 o;
uniform sampler2D tStack; uniform sampler2D tStackE; uniform vec2 uTexel; uniform int uCh;
uniform vec3 uCopper; uniform vec3 uHead; uniform float uEnergy; uniform float uAlpha; uniform float uBump;
${LIGHTING}
void main(){
  if (vUv.x < 0.0 || vUv.y < 0.0 || vUv.x > 1.0 || vUv.y > 1.0) discard;
  float cu = texture(tStack, vUv)[uCh]; float en = texture(tStackE, vUv)[uCh];
  if (cu < 0.003 && en < 0.003) discard;
  vec2 dx = vec2(uTexel.x * 1.5, 0.0), dy = vec2(0.0, uTexel.y * 1.5);
  vec2 g = vec2(textureLod(tStack, vUv + dx, 0.6)[uCh] - textureLod(tStack, vUv - dx, 0.6)[uCh],
                textureLod(tStack, vUv + dy, 0.6)[uCh] - textureLod(tStack, vUv - dy, 0.6)[uCh]) * uBump;
  vec3 V = normalize(uCam - vW);
  vec3 col = shade(normalize(vec3(-g.x, g.y, 1.0)), V, uCopper * 0.92, 1.0, 0.26, 0.04);
  // floating copper catches the room: a warm ambient keeps each layer legible
  col += uCopper * 0.09;
  col += uHead * pow(en, 1.4) * uEnergy;
  float a = clamp(max(cu, en) * uAlpha, 0.0, 1.0);
  o = vec4(col * a, a);
}`

const FS_GLASS = `#version 300 es
precision highp float;
in vec2 vUv; in vec3 vW; out vec4 o;
uniform sampler2D tSurf; uniform vec2 uTexel; uniform vec3 uSub; uniform vec3 uHead; uniform float uAlpha;
void main(){
  if (vUv.x < 0.0 || vUv.y < 0.0 || vUv.x > 1.0 || vUv.y > 1.0) discard;
  float area = texture(tSurf, vUv).b;
  float blur = textureLod(tSurf, vUv, 3.0).b;
  float rim = clamp(abs(area - blur) * 3.0, 0.0, 1.0);
  float a = (area * 0.2 + rim * 0.5) * uAlpha;
  if (a < 0.002) discard;
  vec3 col = uSub * 0.6 + uHead * rim * 0.5;
  o = vec4(col * a, a);
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
uniform vec3 uSub; uniform vec3 uCopper; uniform float uLayers; uniform float uAlpha; uniform float uPxPerMm;
${LIGHTING}
void main(){
  vec3 V = normalize(uCam - vW);
  vec3 N = dot(vN, V) < 0.0 ? -vN : vN;
  // the cross-section: laminate with a copper line at every layer
  float band = 0.0;
  for (float i = 0.0; i < 6.0; i += 1.0) {
    if (i >= uLayers) break;
    float li = uLayers > 1.0 ? i / (uLayers - 1.0) : 0.0;
    band = max(band, exp(-pow((vF - li) / 0.035, 2.0)));
  }
  float fibre = 0.5 + 0.5 * sin(vF * 70.0);
  vec3 lam = shade(N, V, uSub * (1.2 + 0.4 * fibre), 0.0, 0.7, 0.04);
  vec3 cu = shade(N, V, uCopper, 1.0, 0.3, 0.04);
  vec3 col = mix(lam, cu, band);
  o = vec4(col * uAlpha, uAlpha);
}`

const VS_VIA = `#version 300 es
in vec3 aVia; // plane x, plane y, radius px
uniform mat4 uVP; uniform vec3 uRight; uniform float uZTop; uniform float uZBot;
out float vU; out float vV; flat out float vSeed;
void main(){
  float u = float(gl_VertexID & 1), v = float(gl_VertexID >> 1);
  vU = u; vV = v;
  vSeed = fract(sin(dot(aVia.xy, vec2(12.9898, 78.233))) * 43758.5453);
  vec3 w = vec3(aVia.x, -aVia.y, mix(uZBot, uZTop, v)) + uRight * (u - 0.5) * max(aVia.z * 1.6, 2.0);
  gl_Position = uVP * vec4(w, 1.0);
}`

const FS_VIA = `#version 300 es
precision highp float;
in float vU; in float vV; flat in float vSeed; out vec4 o;
uniform vec3 uHead; uniform float uGlow; uniform float uPhase;
void main(){
  float core = pow(1.0 - abs(vU * 2.0 - 1.0), 3.0);
  // a faint barrel, and on some vias a bead of light dropping through the stack
  float lit = step(0.72, fract(vSeed * 7.13));
  float ph = fract(uPhase + vSeed);
  float bead = lit * exp(-pow((1.0 - vV - ph) / 0.05, 2.0));
  o = vec4(uHead * core * uGlow * (0.025 + 2.0 * bead), 0.0);
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
    float w = smoothstep(r - 1.5, r + 0.5, coc(q) + 1.0);
    acc += texture(t, q) * w; wsum += w;
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
  c = pow(c, vec3(1.0 / 2.2));
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

// ---------------------------------------------------------------- camera

type V3 = [number, number, number]
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}

export interface Cam {
  pos: V3
  f: V3
  r: V3
  u: V3
  dist: number
  tanX: number
  tanY: number
  vp: Float32Array
  aperture: number
}

const SHOT_KEYS = ['x', 'y', 'zoom', 'tilt', 'yaw', 'aperture'] as const

/**
 * Monotone cubic through the shot keys: the camera glides through a key
 * when the move continues, and settles on it when the move turns around.
 */
export function sampleShot(shots: CameraShot[], p: number): Omit<CameraShot, 't'> {
  const out = { x: 0, y: 0, zoom: 1, tilt: 0, yaw: 0, aperture: 0 }
  if (shots.length === 0) return out
  let k = 0
  while (k + 1 < shots.length && (shots[k + 1] as CameraShot).t <= p) k++
  const a = shots[k] as CameraShot
  const b = shots[Math.min(k + 1, shots.length - 1)] as CameraShot
  const h = b.t - a.t
  const u = h > 0 ? Math.min(1, Math.max(0, (p - a.t) / h)) : 0
  for (const key of SHOT_KEYS) {
    const slope = (i: number): number => {
      const prev = shots[i - 1]
      const cur = shots[i] as CameraShot
      const next = shots[i + 1]
      if (prev === undefined || next === undefined) return 0
      const d0 = (cur[key] - prev[key]) / Math.max(1e-6, cur.t - prev.t)
      const d1 = (next[key] - cur[key]) / Math.max(1e-6, next.t - cur.t)
      return d0 * d1 <= 0 ? 0 : (2 * d0 * d1) / (d0 + d1)
    }
    const m0 = slope(k) * h
    const m1 = slope(Math.min(k + 1, shots.length - 1)) * h
    const u2 = u * u
    const u3 = u2 * u
    out[key] = (2 * u3 - 3 * u2 + 1) * a[key] + (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * b[key] + (u3 - u2) * m1
  }
  return out
}

export function makeCam(shot: Omit<CameraShot, 't'>, W: number, H: number): Cam {
  const tanY = Math.tan(FOV / 2)
  const tanX = tanY * (W / H)
  const dist = H / 2 / tanY / Math.max(0.05, shot.zoom)
  const T: V3 = [shot.x, -shot.y, 0]
  const st = Math.sin(shot.tilt)
  const pos: V3 = [T[0] + dist * st * Math.sin(shot.yaw), T[1] - dist * st * Math.cos(shot.yaw), dist * Math.cos(shot.tilt)]
  const f = norm(sub(T, pos))
  const r: V3 = [Math.cos(shot.yaw), Math.sin(shot.yaw), 0]
  const u = norm(cross(r, f))
  const near = dist * 0.02
  const far = dist * 20
  const view = [
    r[0], u[0], -f[0], 0,
    r[1], u[1], -f[1], 0,
    r[2], u[2], -f[2], 0,
    -dot(r, pos), -dot(u, pos), dot(f, pos), 1
  ]
  const py = 1 / tanY
  const px = 1 / tanX
  const proj = [px, 0, 0, 0, 0, py, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0]
  const vp = new Float32Array(16)
  for (let c = 0; c < 4; c++) {
    for (let rr = 0; rr < 4; rr++) {
      let s = 0
      for (let k = 0; k < 4; k++) s += (proj[k * 4 + rr] as number) * (view[c * 4 + k] as number)
      vp[c * 4 + rr] = s
    }
  }
  return { pos, f, r, u, dist, tanX, tanY, vp, aperture: shot.aperture }
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

// ---------------------------------------------------------------- renderer

export function createTraceGL(width: number, height: number, subframes: number): TraceGL | undefined {
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
    wall: link(g, VS_WALL, FS_WALL),
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

  // map resolution: ~1.6× the frame, under the 4096 texture cap
  const k = Math.min(1.6, 4096 / Math.max(width, height))
  const MW = Math.round(width * k)
  const MH = Math.round(height * k)
  const maps: MapSet = createMaps(MW, MH)
  const mapTex = [0, 1, 2, 3].map(() => {
    const t = g.createTexture()
    g.bindTexture(g.TEXTURE_2D, t)
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR_MIPMAP_LINEAR)
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR)
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE)
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE)
    if (aniso !== null) g.texParameterf(g.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, 8)
    return t
  })

  const target = (w: number, h: number): Target => {
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
    return { tex, fbo, w, h }
  }
  const scene = target(width, height)
  const accum = target(width, height)
  const dof = target(width, height)
  const pyramid: Target[] = []
  for (let i = 0, w = Math.ceil(width / 2), h = Math.ceil(height / 2); i < 6; i++, w = Math.max(1, w >> 1), h = Math.max(1, h >> 1)) pyramid.push(target(w, h))
  const sw = Math.ceil(width / 4)
  const sh = Math.ceil(height / 4)
  const streakA = target(sw, sh)
  const streakB = target(sw, sh)

  const bind = (t: Target | null): void => {
    g.bindFramebuffer(g.FRAMEBUFFER, t?.fbo ?? null)
    g.viewport(0, 0, t?.w ?? width, t?.h ?? height)
  }
  const tex = (unit: number, t: WebGLTexture): void => {
    g.activeTexture(g.TEXTURE0 + unit)
    g.bindTexture(g.TEXTURE_2D, t)
  }
  const quad = (): void => { g.drawArrays(g.TRIANGLES, 0, 3); }

  // per-timeline geometry: board walls and vias
  let builtFor: TraceTimeline | undefined
  let wallBuf: WebGLBuffer | undefined
  let wallCount = 0
  let viaBuf: WebGLBuffer | undefined
  let viaCount = 0
  let extent: Region = { x: 0, y: 0, w: width, h: height }
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
    wallBuf ??= g.createBuffer()
    g.bindBuffer(g.ARRAY_BUFFER, wallBuf)
    g.bufferData(g.ARRAY_BUFFER, new Float32Array(walls), g.STATIC_DRAW)
    wallCount = walls.length / 4
    viaBuf ??= g.createBuffer()
    g.bindBuffer(g.ARRAY_BUFFER, viaBuf)
    g.bufferData(g.ARRAY_BUFFER, new Float32Array(s.vias.flatMap((v) => [v.x, v.y, v.r])), g.STATIC_DRAW)
    viaCount = s.vias.length
  }

  /** the region to rasterise: what the camera sees of the board (both stack ends) */
  const regionFor = (cam: Cam, zs: number[]): Region => {
    let r: Region | undefined
    for (const z of zs) {
      const f = footprint(cam, z)
      r = r === undefined ? f : (() => {
        const xa = Math.min(r.x, f.x)
        const ya = Math.min(r.y, f.y)
        return { x: xa, y: ya, w: Math.max(r.x + r.w, f.x + f.w) - xa, h: Math.max(r.y + r.h, f.y + f.h) - ya }
      })()
    }
    const f = r as Region
    const xa = Math.max(f.x, extent.x)
    const ya = Math.max(f.y, extent.y)
    const xb = Math.min(f.x + f.w, extent.x + extent.w)
    const yb = Math.min(f.y + f.h, extent.y + extent.h)
    let w = Math.max(8, xb - xa)
    let h = Math.max(8, yb - ya)
    // match the map's aspect so texels stay square
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
    // a low key raking across the board, drifting through the film
    const az = -2.35 + p * 1.1
    const el = 0.52
    prog.v3('uCam', cam.pos)
      .f('uKey', Math.cos(az) * Math.cos(el), Math.sin(az) * Math.cos(el), Math.sin(el))
      .f('uKeyCol', 3.1, 2.9, 2.6)
      .f('uFill', 0.05, 0.055, 0.065)
      .f('uBoxN', 0.6, -0.8, 0)
      .f('uBoxPos', -0.9 + sweep * 1.8)
      .f('uBoxGain', 0.38)
  }

  return {
    render(tl: TraceTimeline, frame: number): HTMLCanvasElement {
      if (g.isContextLost()) return canvas
      build(tl)
      const s = tl.scene
      const W = width
      const H = height
      const p = frame / tl.totalFrames
      const acts = s.acts
      const ease = (x: number): number => {
        const t = Math.min(1, Math.max(0, x))
        return t * t * (3 - 2 * t)
      }
      const span = (a: [number, number]): number => ease((p - a[0]) / (a[1] - a[0]))
      // the stack: lift out with a long ease, slam home with an accelerating fall
      const lift = 1 - Math.pow(1 - Math.min(1, Math.max(0, (p - acts.explode[0]) / (acts.explode[1] - acts.explode[0]))), 3)
      const fall = Math.min(1, Math.max(0, (p - acts.slam[0]) / (acts.slam[1] - acts.slam[0])))
      const explode = p < acts.explode[0] ? 0 : p < acts.slam[0] ? lift : Math.max(0, 1 - fall * fall)
      const sinceSlam = p - acts.slam[1]
      const slam = sinceSlam >= 0 ? Math.exp(-sinceSlam * 90) : 0
      const fade = 1 - span([0.975, 1])
      const sweep = (p - acts.sweep[0]) / (acts.sweep[1] - acts.sweep[0])

      const nLayers = Math.max(1, s.layers.length)
      const S = 0.17 * Math.min(W, H) * explode
      const zOf = (i: number): number => S * ((nLayers - 1) / 2 - i)

      // camera at the frame centre for the maps, and for depth of field
      const shake = (q: number): { dx: number; dy: number } => {
        const t = q - acts.slam[1]
        if (t < 0) return { dx: 0, dy: 0 }
        const a = Math.exp(-t * 60) * 0.006 * Math.min(W, H)
        return { dx: a * Math.sin(t * 900), dy: a * Math.cos(t * 1130) }
      }
      const camAt = (q: number): Cam => {
        const shot = sampleShot(s.shots, q)
        const sh = shake(q)
        return makeCam({ ...shot, x: shot.x + sh.dx, y: shot.y + sh.dy }, W, H)
      }
      const cam = camAt(p)
      const region = regionFor(cam, explode > 0.001 ? [zOf(0), zOf(nLayers - 1)] : [0])
      const withStack = explode > 0.001
      drawMaps(maps, tl, p, region, withStack)
      upload(0, maps.top)
      upload(1, maps.surf)
      if (withStack) {
        upload(2, maps.stack)
        upload(3, maps.stackE)
      }

      const pal = tl.palette
      const m = s.material
      const head = linear(pal.head)
      const copper = linear(pal.copper)
      const texel = [1 / MW, 1 / MH] as const
      const regionV = [region.x, region.y, region.w, region.h] as const
      const maskSpan = span(acts.mask)
      const maskOn = p >= acts.mask[0] ? 1 : 0
      const soft = 0.08 * extent.h
      const maskFront = extent.y - soft + maskSpan * (extent.h + 2 * soft)
      const energyGain = 3.2
      const sweepDir = norm([1, 0.55, 0])
      const corners = [[extent.x, extent.y], [extent.x + extent.w, extent.y], [extent.x, extent.y + extent.h], [extent.x + extent.w, extent.y + extent.h]]
        .map(([x, y]) => (x as number) * sweepDir[0] + (y as number) * sweepDir[1])
      const sLo = Math.min(...corners)
      const sHi = Math.max(...corners)
      const sweepW = 0.05 * (sHi - sLo)
      const sweepV = [sLo - sweepW * 2 + Math.min(1, Math.max(0, sweep)) * (sHi - sLo + sweepW * 4), sweepW, sweep > 0 && sweep < 1 ? 0.32 : 0] as const

      const drawScene = (c: Cam): void => {
        g.disable(g.DEPTH_TEST)
        g.enable(g.BLEND)
        g.blendFunc(g.ONE, g.ONE_MINUS_SRC_ALPHA)
        g.clearColor(0, 0, 0, 0)
        g.clear(g.COLOR_BUFFER_BIT)
        g.bindVertexArray(vao)
        if (withStack) {
          // bottom of the stack first; glass sheets between the copper layers
          for (let i = nLayers - 1; i >= 1; i--) {
            const ch = lowerChannel(s, i)
            tex(0, mapTex[2] as WebGLTexture)
            tex(1, mapTex[3] as WebGLTexture)
            P.layer.use().m4('uVP', c.vp).f('uRegion', ...regionV).f('uZ', zOf(i)).i('tStack', 0).i('tStackE', 1)
              .f('uTexel', ...texel).i('uCh', ch).v3('uCopper', copper).v3('uHead', head).f('uEnergy', energyGain)
              .f('uAlpha', Math.min(1, explode * 3)).f('uBump', 1.4)
            lighting(P.layer, c, p, sweep)
            g.drawArrays(g.TRIANGLE_STRIP, 0, 4)
            tex(0, mapTex[1] as WebGLTexture)
            P.glass.use().m4('uVP', c.vp).f('uRegion', ...regionV).f('uZ', (zOf(i) + zOf(i - 1)) / 2).i('tSurf', 0)
              .f('uTexel', ...texel).v3('uSub', linear(m.substrate)).v3('uHead', head).f('uAlpha', explode)
            g.drawArrays(g.TRIANGLE_STRIP, 0, 4)
          }
        } else if (wallCount > 0 && wallBuf !== undefined) {
          // the board's edge: laminate with a copper line per layer
          g.bindBuffer(g.ARRAY_BUFFER, wallBuf)
          const loc = g.getAttribLocation(P.wall.p, 'aWall')
          g.enableVertexAttribArray(loc)
          g.vertexAttribPointer(loc, 4, g.FLOAT, false, 0, 0)
          P.wall.use().m4('uVP', c.vp).f('uThick', Math.max(2, m.thicknessPx * 1.4)).f('uZ', 0)
            .v3('uSub', linear(m.substrate)).v3('uCopper', copper).f('uLayers', nLayers).f('uAlpha', 1).f('uPxPerMm', m.pxPerMm)
          lighting(P.wall, c, p, sweep)
          g.drawArrays(g.TRIANGLES, 0, wallCount)
          g.disableVertexAttribArray(loc)
        }
        tex(0, mapTex[0] as WebGLTexture)
        tex(1, mapTex[1] as WebGLTexture)
        P.top.use().m4('uVP', c.vp).f('uRegion', ...regionV).f('uZ', zOf(0)).i('tTop', 0).i('tSurf', 1)
          .f('uTexel', ...texel).v3('uCopper', copper).v3('uFinish', linear(m.finish)).v3('uMask', linear(m.mask))
          .v3('uSub', linear(m.substrate)).v3('uSilk', linear('#f1f0ea')).v3('uHead', head)
          .f('uFinishRough', m.finishRough).f('uMaskFront', maskFront).f('uMaskSoft', soft).f('uMaskOn', maskOn)
          .f('uSubAlpha', 1 - explode * 0.88).f('uEnergy', energyGain).f('uSlam', slam).f('uPxPerMm', m.pxPerMm).f('uBump', 1.6)
          .f('uSweepDir', sweepDir[0], sweepDir[1]).f('uSweep', ...sweepV)
        lighting(P.top, c, p, sweep)
        g.drawArrays(g.TRIANGLE_STRIP, 0, 4)
        if (withStack && viaCount > 0 && viaBuf !== undefined) {
          // vias stand up as light between the layers, brightest on the bus beats
          g.blendFunc(g.ONE, g.ONE)
          g.bindBuffer(g.ARRAY_BUFFER, viaBuf)
          const loc = g.getAttribLocation(P.via.p, 'aVia')
          g.enableVertexAttribArray(loc)
          g.vertexAttribPointer(loc, 3, g.FLOAT, false, 0, 0)
          g.vertexAttribDivisor(loc, 1)
          P.via.use().m4('uVP', c.vp).v3('uRight', c.r).f('uZTop', zOf(0)).f('uZBot', zOf(nLayers - 1))
            .v3('uHead', head).f('uGlow', explode).f('uPhase', (p - acts.explode[0]) * 9)
          g.drawArraysInstanced(g.TRIANGLE_STRIP, 0, 4, viaCount)
          g.vertexAttribDivisor(loc, 0)
          g.disableVertexAttribArray(loc)
        }
      }

      // motion blur: the camera samples a 180° shutter; maps hold per frame
      const n = Math.max(1, subframes)
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
        .f('uBloom', 0.7 * pal.bloom + 0.2).f('uStreak', 0.12).v3('uStreakTint', head)
        .f('uExposure', 1.15 * fade).f('uCA', 0.0012).f('uFrame', frame).i('uGrain', tl.transparent ? 0 : 1)
        .i('uTransparent', tl.transparent ? 1 : 0).v3('uBg', bg).f('uVignette', 0.32)
      g.clearColor(0, 0, 0, 0)
      g.clear(g.COLOR_BUFFER_BIT)
      quad()
      g.finish()
      return canvas
    },
    dispose(): void {
      g.getExtension('WEBGL_lose_context')?.loseContext()
    }
  }
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
  // stack order below the top: inner layers, then the back
  const ordered = [...inner, ...lower.filter((l) => l.side !== 'inner')]
  const layer = ordered[idx - 1]
  if (layer === undefined) return 2
  return layer.side === 'B' ? 2 : (inner.indexOf(layer) % 2 === 0 ? 0 : 1)
}
