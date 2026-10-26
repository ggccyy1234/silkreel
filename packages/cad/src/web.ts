import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>PCB CAD · 真实模型查看器</title><style>
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;font:14px system-ui,sans-serif;color:#273449;background:transparent}
canvas{display:block;width:100%;height:100%}header{position:absolute;left:24px;top:22px;max-width:calc(100% - 48px);padding:18px 22px;background:#ffffffed;border:1px solid #d9e0e9;border-radius:14px;box-shadow:0 6px 22px #182b4410}
h1{font-size:19px;font-weight:650;margin:0 0 6px}p{margin:5px 0;font-size:12px;color:#637086}nav{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}button,a{font:inherit;color:inherit}button{background:white;border:1px solid #ccd5e2;border-radius:7px;padding:7px 12px;cursor:pointer}button:hover{background:#edf3fb}a{padding:7px}
#notice{max-width:560px;color:#926127}details{margin-top:10px;font-size:12px}#notes{white-space:pre-line;max-width:560px;line-height:1.5;color:#637086}
#title{position:absolute;bottom:6%;left:6%;font-size:28px;font-weight:600;letter-spacing:.03em;color:#273449;pointer-events:none}
html.render header{display:none}
#process{position:absolute;inset:0;pointer-events:none;padding:5vh 5vw;color:#273449}#process[hidden]{display:none}.eyebrow{font-size:clamp(10px,1vw,18px);letter-spacing:.16em;color:#66778b}#process h2{font-size:clamp(24px,2.8vw,54px);font-weight:600;letter-spacing:.08em;margin:12px 0}.eyebrow,h2,#process p{text-shadow:0 1px 10px #edf0f4}#process p{font-size:clamp(11px,1.1vw,21px);margin:0;color:#5c6e81}.layer-list{position:absolute;right:5vw;top:29vh;width:190px;font-size:clamp(10px,.95vw,18px)}.layer-list[hidden]{display:none}.layer-list div{display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid #71809930}.layer-list b{font-weight:400;color:#66778b}.process-foot{position:absolute;left:5vw;bottom:5vh;font-size:clamp(10px,.85vw,16px);color:#68798b}.process-track{position:absolute;left:5vw;right:5vw;bottom:3.5vh;height:2px;background:#8e9dae35}.process-track i{display:block;height:100%;background:#a97039}
html:not(.render) #process{padding-top:230px}html:not(.render) .layer-list{display:none}
</style><script>if(new URLSearchParams(location.search).has('render'))document.documentElement.classList.add('render')</script></head>
<body><canvas></canvas><header><h1>PCB CAD · 真实模型</h1><p id="source"></p><p id="status">正在加载 CAD 几何…</p><p id="notice"></p>
<nav><button data-view="iso">斜视</button><button data-view="top">顶面</button><button data-view="bottom">底面</button><button id="play">转台</button><button id="save">保存图片</button><a href="model.glb" download>下载 GLB</a><a href="manifest.json" download>来源记录</a><a id="film" href="turntable.mp4" download hidden>下载视频</a></nav>
<p>拖动旋转 · 滚轮缩放 · 右键平移</p><details><summary>几何与材质说明</summary><p id="notes"></p></details></header><div id="title"></div><script type="module" src="viewer.js"></script></body></html>`

export async function buildViewer(out: string): Promise<void> {
  await build({ entryPoints: [fileURLToPath(new URL('./viewer.ts', import.meta.url))],
    outfile: path.join(out, 'viewer.js'), bundle: true, minify: true, platform: 'browser', format: 'esm', target: 'es2022', legalComments: 'eof' })
  await writeFile(path.join(out, 'index.html'), html)
}

export async function serve(out: string, port = 0): Promise<{ server: Server; url: string }> {
  const files: Record<string, string> = { '/': 'index.html', '/index.html': 'index.html', '/viewer.js': 'viewer.js', '/model.glb': 'model.glb', '/manifest.json': 'manifest.json', '/status.json': 'status.json', '/manufacturing.json': 'manufacturing.json', '/exploded.png': 'exploded.png', '/turntable.mp4': 'turntable.mp4', '/cover.png': 'cover.png', '/top.png': 'top.png', '/bottom.png': 'bottom.png' }
  const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.glb': 'model/gltf-binary', '.json': 'application/json', '.mp4': 'video/mp4', '.png': 'image/png' }
  const server = createServer((req, res) => {
    void (async () => {
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return }
      const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
      const file = files[pathname]
      if (!file) { res.writeHead(404); res.end(); return }
      const data = await readFile(path.join(out, file))
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream', 'Content-Length': data.length,
        'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' })
      res.end(req.method === 'HEAD' ? undefined : data)
    })().catch(() => { res.writeHead(500); res.end('Unable to read prepared CAD output') })
  })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No listening TCP port')
  return { server, url: `http://127.0.0.1:${address.port}` }
}
