import { LF, N, WS } from './strip'

/**
 * The film wound flat, heads out: an Archimedean spiral of stock with a straight leader leaving its
 * twelve o'clock point. Every pixel finds its place on the strip (the inverse of /tmp/silk-paper/reel.py),
 * so the coil stays exact at any size and turns as `ex` pays drawings out onto the leader.
 */
const FRAG = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uK;
uniform vec2 uC;
uniform float uLeader;
uniform float uEx;
uniform sampler2D uAtlas;
uniform vec2 uAtlasSize;
uniform float uT;
uniform sampler2D uHead;
uniform vec2 uHeadSize;
uniform float uTH;
uniform vec3 uGround;
out vec4 o;
const float N = ${N.toFixed(1)}, LF = ${LF.toFixed(1)}, WS = ${WS.toFixed(1)}, P = ${(WS + 8).toFixed(1)}, A = 300.0, PI = 3.14159265, COLS = 14.0;
void main() {
  vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  float Lrem = (N - uEx) * LF;
  float qa = P / (4.0 * PI);
  float phimax = (-A + sqrt(A * A + 4.0 * qa * Lrem)) / (2.0 * qa);
  float rend = A + P * phimax / (2.0 * PI);
  vec2 d = (px - uC) / uK - vec2(0.0, rend);
  float r = length(d);
  float psi = mod(atan(d.x, -d.y), 2.0 * PI) + mod(phimax, 2.0 * PI);
  float phi = psi + 2.0 * PI * floor((r - A - P * psi / (2.0 * PI)) / P + 0.5);
  float u = r - (A + P * phi / (2.0 * PI));
  float q = uEx * LF + (Lrem - (A * phi + qa * phi * phi));
  float tx = N * LF - q, ty = WS * 0.5 - u;
  float cover = (phi >= 0.0 && phi <= phimax) ? clamp((WS * 0.5 - abs(u)) * uK + 0.5, 0.0, 1.0) : 0.0;
  float lu = -d.y - rend;
  if (d.x >= 0.0 && px.x <= uC.x + uLeader && abs(lu) <= WS * 0.5 + 1.0) {
    tx = N * LF - (uEx * LF - d.x);
    ty = WS * 0.5 - lu;
    cover = clamp((WS * 0.5 - abs(lu)) * uK + 0.5, 0.0, 1.0);
  }
  vec3 film = vec3(0.043);
  if (cover > 0.0 && tx >= 0.0) {
    if (tx < N * LF) {
      float c = floor(tx / LF);
      float dd = N - 1.0 - c;
      vec2 cellAt = vec2(mod(dd, COLS), floor(dd / COLS)) * vec2(LF, WS);
      vec2 uv = (cellAt + vec2(tx - c * LF, clamp(ty, 0.5, WS - 0.5))) * uT / uAtlasSize;
      film = textureLod(uAtlas, uv, max(0.0, log2(uT / uK))).rgb;
    } else {
      vec2 uv = vec2(tx - N * LF, clamp(ty, 0.5, WS - 0.5)) * uTH / uHeadSize;
      if (uv.x < 1.0) film = textureLod(uHead, uv, max(0.0, log2(uTH / uK))).rgb;
    }
  }
  o = vec4(mix(uGround, film, cover), 1.0);
}`

const VERT = `#version 300 es
in vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }`

export interface ReelPose {
  /** CSS px per strip unit */
  k: number
  /** coil centre x and the leader's y, in CSS px */
  cx: number
  ly: number
  /** leader length in CSS px from the centre line */
  leader: number
  /** drawings paid out onto the leader */
  ex: number
}

const hex3 = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)

export class ReelGL {
  private gl: WebGL2RenderingContext
  private prog: WebGLProgram
  private u: Record<string, WebGLUniformLocation | null> = {}
  private sizes = { atlas: [1, 1], head: [1, 1] }
  readonly canvas: HTMLCanvasElement

  constructor(canvas: HTMLCanvasElement, atlas: { canvas: HTMLCanvasElement; t: number }, head: { canvas: HTMLCanvasElement; t: number }, ground: string) {
    this.canvas = canvas
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: false })
    if (!gl) throw new Error('no webgl2')
    this.gl = gl
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)
      if (!s) throw new Error('no shader')
      gl.shaderSource(s, src)
      gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader')
      return s
    }
    const prog = gl.createProgram()
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT))
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG))
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link')
    this.prog = prog
    gl.useProgram(prog)
    for (const n of ['uRes', 'uK', 'uC', 'uLeader', 'uEx', 'uAtlas', 'uAtlasSize', 'uT', 'uHead', 'uHeadSize', 'uTH', 'uGround']) this.u[n] = gl.getUniformLocation(prog, n)
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(prog, 'p')
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
    this.texture(0, atlas.canvas)
    this.texture(1, head.canvas)
    this.sizes = { atlas: [atlas.canvas.width, atlas.canvas.height], head: [head.canvas.width, head.canvas.height] }
    gl.uniform1i(this.u.uAtlas ?? null, 0)
    gl.uniform1i(this.u.uHead ?? null, 1)
    gl.uniform1f(this.u.uT ?? null, atlas.t)
    gl.uniform1f(this.u.uTH ?? null, head.t)
    gl.uniform3fv(this.u.uGround ?? null, hex3(ground))
  }

  private texture(unit: number, src: HTMLCanvasElement) {
    const gl = this.gl
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture())
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src)
    gl.generateMipmap(gl.TEXTURE_2D)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  }

  setGround(hex: string) { this.gl.uniform3fv(this.u.uGround ?? null, hex3(hex)) }

  draw(pose: ReelPose, dpr: number) {
    const gl = this.gl
    const w = Math.round(this.canvas.clientWidth * dpr), h = Math.round(this.canvas.clientHeight * dpr)
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h }
    gl.viewport(0, 0, w, h)
    gl.uniform2f(this.u.uRes ?? null, w, h)
    gl.uniform1f(this.u.uK ?? null, pose.k * dpr)
    gl.uniform2f(this.u.uC ?? null, pose.cx * dpr, pose.ly * dpr)
    gl.uniform1f(this.u.uLeader ?? null, pose.leader * dpr)
    gl.uniform1f(this.u.uEx ?? null, pose.ex)
    gl.uniform2f(this.u.uAtlasSize ?? null, this.sizes.atlas[0] ?? 1, this.sizes.atlas[1] ?? 1)
    gl.uniform2f(this.u.uHeadSize ?? null, this.sizes.head[0] ?? 1, this.sizes.head[1] ?? 1)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }
}

