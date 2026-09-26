// WebGL2 post pass: soft-knee bright pass -> dual-Kawase blur pyramid ->
// composite (bloom + vignette + grain/dither). Stateless per frame; the caller
// uploads the freshly drawn 2D canvas each render.
export interface PostOptions {
  /** 0..1 bloom strength (palette.bloom) */
  bloom: number
  grain: boolean
  vignette: boolean
  /** alpha-capable output: skip vignette/grain, keep alpha from bloom */
  transparent: boolean
  frame: number
}

export interface Post {
  /** post-processes `src` on the pass's own WebGL canvas and returns it for the caller to drawImage */
  render(src: HTMLCanvasElement, o: PostOptions): HTMLCanvasElement
  dispose(): void
}

const VERT = `#version 300 es
out vec2 uv;
void main(){ vec2 p = vec2((gl_VertexID<<1)&2, gl_VertexID&2); uv = p; gl_Position = vec4(p*2.0-1.0,0.,1.); }
`

const BRIGHT = `#version 300 es
precision highp float; in vec2 uv; out vec4 o; uniform sampler2D t;
void main(){ vec3 c = texture(t, uv).rgb; float l = dot(c, vec3(.2126,.7152,.0722));
  float k = clamp((l - 0.65) / 0.30, 0., 1.); o = vec4(c * k * k, 1.); }
`

const DOWN = `#version 300 es
precision highp float; in vec2 uv; out vec4 o; uniform sampler2D t; uniform vec2 h; // half texel of SOURCE
void main(){ vec4 s = texture(t, uv) * 4.0;
  s += texture(t, uv - h) + texture(t, uv + h) + texture(t, uv + vec2(h.x,-h.y)) + texture(t, uv - vec2(h.x,-h.y));
  o = s / 8.0; }
`

const UP = `#version 300 es
precision highp float; in vec2 uv; out vec4 o; uniform sampler2D t; uniform vec2 h;
void main(){ vec4 s = texture(t, uv + vec2(-h.x*2.,0.)) + texture(t, uv + vec2(h.x*2.,0.))
  + texture(t, uv + vec2(0.,-h.y*2.)) + texture(t, uv + vec2(0.,h.y*2.));
  s += (texture(t, uv + vec2(-h.x,h.y)) + texture(t, uv + h) + texture(t, uv + vec2(h.x,-h.y)) + texture(t, uv - h)) * 2.0;
  o = s / 12.0; }
`

const COMPOSITE = `#version 300 es
precision highp float; in vec2 uv; out vec4 o;
uniform sampler2D base; uniform sampler2D bloom; uniform float strength; uniform float frame;
uniform bool vignette; uniform bool grain; uniform bool transparent;
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
void main(){ vec2 f = vec2(uv.x, 1.0 - uv.y); // canvas texture is top-down
  vec4 b = texture(base, f); vec3 g = texture(bloom, f).rgb * strength;
  vec3 c = b.rgb + g;
  if (vignette && !transparent) c *= mix(1.0, smoothstep(1.2, .35, length(f - .5) * 1.4), .35);
  if (grain && !transparent) c += (hash(gl_FragCoord.xy + frame * 17.0) - .5) * (2.0/255.0);
  float a = transparent ? max(b.a, dot(g, vec3(.2126,.7152,.0722))) : 1.0;
  o = vec4(c, a); }
`

const LEVELS = 5 // dual-Kawase depth: half-res bright + 5 down / 5 up

function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | undefined {
  const sh = gl.createShader(type)
  if (sh === null) return undefined
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (gl.getShaderParameter(sh, gl.COMPILE_STATUS) !== true) {
    console.warn(`post shader: ${gl.getShaderInfoLog(sh) ?? 'compile failed'}`)
    gl.deleteShader(sh)
    return undefined
  }
  return sh
}

function linkProgram(gl: WebGL2RenderingContext, fragSrc: string, vert: WebGLShader): WebGLProgram | undefined {
  const frag = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc)
  if (frag === undefined) return undefined
  // ponytail: TS DOM types claim these GL factories never return null; they do on
  // context loss, so widen via assertion rather than dropping the runtime checks.
  const prog = gl.createProgram() as WebGLProgram | null
  if (prog === null) return undefined
  gl.attachShader(prog, vert)
  gl.attachShader(prog, frag)
  gl.linkProgram(prog)
  gl.deleteShader(frag)
  if (gl.getProgramParameter(prog, gl.LINK_STATUS) !== true) {
    console.warn(`post program: ${gl.getProgramInfoLog(prog) ?? 'link failed'}`)
    gl.deleteProgram(prog)
    return undefined
  }
  return prog
}

interface Target { tex: WebGLTexture; fbo: WebGLFramebuffer; w: number; h: number }

function makeTarget(gl: WebGL2RenderingContext, w: number, h: number): Target | undefined {
  const tex = gl.createTexture() as WebGLTexture | null
  const fbo = gl.createFramebuffer() as WebGLFramebuffer | null
  if (tex === null || fbo === null) return undefined
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  return ok ? { tex, fbo, w, h } : undefined
}

/**
 * returns undefined when WebGL2 is unavailable — caller falls back to drawImage.
 * The pass owns its GL canvas so the visible canvas keeps a 2d context: once a
 * canvas hands out webgl2 it can never give 2d, which would blank the fallback.
 */
export function createPost(): Post | undefined {
  const canvas = document.createElement('canvas')
  let gl: WebGL2RenderingContext | null = null
  try {
    gl = canvas.getContext('webgl2', {
      premultipliedAlpha: true,
      preserveDrawingBuffer: true,
      antialias: false
    })
  } catch {
    return undefined
  }
  if (gl === null) return undefined

  const vert = compileShader(gl, gl.VERTEX_SHADER, VERT)
  const programs = vert !== undefined
    ? ([linkProgram(gl, BRIGHT, vert), linkProgram(gl, DOWN, vert), linkProgram(gl, UP, vert), linkProgram(gl, COMPOSITE, vert)] as const)
    : undefined
  const vao = gl.createVertexArray() as WebGLVertexArrayObject | null
  const srcTex = gl.createTexture() as WebGLTexture | null
  if (vert === undefined || programs === undefined || programs.some((p) => p === undefined) || vao === null || srcTex === null) {
    return undefined
  }
  const [bright, down, up, composite] = programs as [WebGLProgram, WebGLProgram, WebGLProgram, WebGLProgram]

  gl.bindVertexArray(vao)
  gl.bindTexture(gl.TEXTURE_2D, srcTex)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)

  const uDownH = gl.getUniformLocation(down, 'h')
  const uUpH = gl.getUniformLocation(up, 'h')
  const uBase = gl.getUniformLocation(composite, 'base')
  const uBloom = gl.getUniformLocation(composite, 'bloom')
  const uStrength = gl.getUniformLocation(composite, 'strength')
  const uFrame = gl.getUniformLocation(composite, 'frame')
  const uVignette = gl.getUniformLocation(composite, 'vignette')
  const uGrain = gl.getUniformLocation(composite, 'grain')
  const uTransparent = gl.getUniformLocation(composite, 'transparent')

  let levels: Target[] = []
  let sizedW = 0
  let sizedH = 0
  const ensureTargets = (w: number, h: number): boolean => {
    if (w === sizedW && h === sizedH) return true
    for (const t of levels) {
      gl.deleteTexture(t.tex)
      gl.deleteFramebuffer(t.fbo)
    }
    levels = []
    canvas.width = w
    canvas.height = h
    let lw = Math.max(1, Math.ceil(w / 2))
    let lh = Math.max(1, Math.ceil(h / 2))
    for (let i = 0; i <= LEVELS; i++) {
      const t = makeTarget(gl, lw, lh)
      if (t === undefined) return false
      levels.push(t)
      lw = Math.max(1, Math.floor(lw / 2))
      lh = Math.max(1, Math.floor(lh / 2))
    }
    sizedW = w
    sizedH = h
    return true
  }

  const bind = (prog: WebGLProgram, target: Target | null): void => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target?.fbo ?? null)
    gl.viewport(0, 0, target?.w ?? canvas.width, target?.h ?? canvas.height)
    gl.useProgram(prog)
  }

  return {
    render(src: HTMLCanvasElement, o: PostOptions): HTMLCanvasElement {
      if (gl.isContextLost() || !ensureTargets(src.width, src.height)) return src
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, srcTex)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src)

      gl.disable(gl.BLEND)
      // bright pass into level 0, then downsample the pyramid
      bind(bright, levels[0] as Target)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      for (let i = 1; i < levels.length; i++) {
        const src_ = levels[i - 1] as Target
        gl.bindTexture(gl.TEXTURE_2D, src_.tex)
        bind(down, levels[i] as Target)
        gl.uniform2f(uDownH, 0.5 / src_.w, 0.5 / src_.h)
        gl.drawArrays(gl.TRIANGLES, 0, 3)
      }
      // upsample, accumulating additively into each larger level
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.ONE, gl.ONE)
      for (let i = levels.length - 1; i > 0; i--) {
        const src_ = levels[i] as Target
        gl.bindTexture(gl.TEXTURE_2D, src_.tex)
        bind(up, levels[i - 1] as Target)
        gl.uniform2f(uUpH, 0.5 / src_.w, 0.5 / src_.h)
        gl.drawArrays(gl.TRIANGLES, 0, 3)
      }
      gl.disable(gl.BLEND)

      bind(composite, null)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, srcTex)
      gl.uniform1i(uBase, 0)
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, (levels[0] as Target).tex)
      gl.uniform1i(uBloom, 1)
      gl.uniform1f(uStrength, o.bloom)
      gl.uniform1f(uFrame, o.frame)
      gl.uniform1i(uVignette, o.vignette ? 1 : 0)
      gl.uniform1i(uGrain, o.grain ? 1 : 0)
      gl.uniform1i(uTransparent, o.transparent ? 1 : 0)
      gl.activeTexture(gl.TEXTURE0)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      gl.finish()
      return canvas
    },
    dispose(): void {
      for (const t of levels) {
        gl.deleteTexture(t.tex)
        gl.deleteFramebuffer(t.fbo)
      }
      levels = []
      gl.deleteTexture(srcTex)
      gl.deleteVertexArray(vao)
      for (const p of [bright, down, up, composite]) gl.deleteProgram(p)
      gl.deleteShader(vert)
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
  }
}
