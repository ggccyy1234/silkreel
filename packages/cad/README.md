# PCB CAD：真实 KiCad / STEP 模型渲染

独立于原来的 trace/glyph 渲染器。输入 `.kicad_pcb` 或整板 `.step/.stp`，输出可旋转查看的真实 CAD 装配、PNG、GLB 和 MP4。不会按位号、焊盘尺寸或封装名字生成替代外形。

本版为 `v0.2.0-cad.1` 预发布版。使用前必须让 Agent 阅读[根目录 README](../../README.md) 的兼容矩阵和完整验收清单；脚本运行本身不依赖 LLM。本页提供技术细节，不能替代逐帧和全片视觉检查。

## 安装

需要 Node.js 22+、Chrome/Edge/Chromium；**KiCad 10 必装**，发布版仅验证 Windows x64 + KiCad 10。KiCad 需包含 `kicad-cli`、`pcbnew` Python 和标准 3D 模型库。不得在 KiCad 缺失时用推测模型继续。视频编码优先使用安装的 Remotion FFmpeg，找不到时使用 PATH 或 `--ffmpeg`。

```powershell
npm ci
npm run cad:doctor -- --json
npm run cad:bootstrap -- --python "D:/Program Files/KiCad/10.0/bin/python.exe" --json
```

Python 路径应改为本机已有的解释器。PCB 输入使用 KiCad 的模型转换，不依赖这个 Python 环境。已实测平台为 Windows + KiCad 10；其他平台提供路径发现和覆盖参数，尚未实机验证。

Agent 收到仓库/发布包路径和用户指定的安装/工作目录后，应把该位置作为安装根目录，自动发现并配置依赖；不得照抄另一个用户的盘符或缓存路径。`cad:doctor` 检查全套依赖并输出修复命令；`cad:bootstrap` 安装 npm 依赖、OpenCascade/Pillow 与缺少的 Chromium。KiCad 必须先用系统安装器/包管理器安装。

Agent 必须在目标电脑上重新发现路径，不得复用另一台电脑的盘符或用户名。常用覆盖项：

| 覆盖项 | 用途 |
| --- | --- |
| `KICAD_CLI` / `--kicad` | `kicad-cli` 可执行文件 |
| `KICAD_PYTHON` / `--kicad-python` | 能 `import pcbnew` 的 KiCad Python |
| `CAD_PYTHON` / `--python` | 能 `import OCP` 的 OpenCascade Python |
| `JLC3D_DOWNLOADER` | 明确指定 `JLC3DDownload.py` 或下载器 EXE |
| `JLC3D_HOME` | JLC3D 配置目录，默认 `~/.jlc3d` |
| `JLC3D_DOWNLOAD_PATH` | 覆盖 JLC3D 默认模型目录 |
| `JLC3D_PROXY` / `--jlc-proxy` | JLC 在线请求代理；也可回退 `HTTPS_PROXY` |

## 渲染和查看

```powershell
npm run cad -- render "board.kicad_pcb" --out exports/cad/board
npm run cad -- repair-models "board.kicad_pcb"
npm run cad -- render "board.step" --out exports/cad/step --azimuth=-45 --title "My PCB"
npm run cad -- serve exports/cad/step --port 3103
```

省略 `--out` 时，所有按板输出的命令自动写入 PCB 同目录的 `<板名>-silkreel/`。例如 `/work/board.kicad_pcb` 会写入 `/work/board-silkreel/`，包括图片、GLB、查看器、视频、审计和逐帧报告。

打开打印的 `http://127.0.0.1:3103`。拖动旋转、滚轮缩放、右键平移；可切换正反面、播放转台、保存图片和下载 GLB。服务只监听本机，所有资源在本地。查看器校验模型的 SHA-256。

常用选项：`--still` 只输出静态图，`--width 1920 --height 1080 --fps 30 --duration 12` 控制视频，`--side bottom` 从底面拍摄，`--elevation 55 --azimuth=-45` 控制镜头，`--transparent` 给 PNG 保留透明背景。MP4 使用不透明背景。完整参数见 `npm run cad -- --help`。

输出目录包含：

| 文件 | 内容 |
| --- | --- |
| `cover.png`、`top.png`、`bottom.png` | 斜视、正面、背面图片 |
| `turntable.mp4` | 恒定速度、完整一圈的 H.264 视频；默认 1080p/30fps/12s，无音轨 |
| `model.glb` | 可携带的装配几何、节点与颜色；单位为米，保持源 PCB 的 Z 轴向上 |
| `manifest.json` | 输入/模型 SHA-256、转换器版本、尺寸、网格统计、来源和显示设置 |
| `frame-audit.json` | 每一输出帧的可见网格、投影范围、空几何/裁切检查；不代替视觉验收 |
| `audit.json` | PCB 模型的原路径、解析路径、文件哈希、变换和缺失清单 |
| `index.html`、`viewer.js`、`status.json` | 本地交互查看器；需通过 `serve` 打开 |
| `.cad-cache/` | 按输入内容、模型文件哈希、转换器和网格参数区分的转换缓存 |
| `.jlc-cache/` | JLC 元数据和 STEP 精确模型缓存；已验证模型可离线复用 |
| `model-map.json` / `model-repair.json` | 项目级模型映射及补模来源、哈希、变换和限制记录 |

`prepare` 只转换模型并构建查看器，不启动浏览器拍摄。再次渲染同一个输出目录会复用经过哈希检查的转换缓存。输入文件始终只读。失败任务会写 `status.json`，查看器会拒绝显示上次遗留的结果。

`audit.json` 的 `footprints` 还会列出每个封装的 `value`、`mpn`、`manufacturer`、`supplierPart`、`lcsc`、`package` 和完整属性表，Agent 应据此为缺模封装选择准确型号，而不是仅凭封装名猜测。

## 旋转拆装与制造流程视频

本地脚本入口（不调用 LLM、不需要 API Key）：

```powershell
npm run cad -- manufacture "board.kicad_pcb" --out exports/cad/manufacturing --azimuth=-45
```

自动校验全部声明模型 → 保存只读源快照 → KiCad 原生 STEP 导出 → OpenCascade 转换 → 提取真实制造图形 → 输出视频。不启用同名模型替换。此入口要求全部可见模型可原生导出为 STEP/IGES；遇到 VRML 声明会报错，不自行更换扩展名。依赖 KiCad 10、pcbnew 和上文的 OpenCascade Python 环境。

标题默认取板文件名（`--title` 可指定）。本版制造入口只接受普通 4 / 6 铜层、正厚度且按铜/介质交替的明确叠层；2 层、8 层以上和不规则叠层会拒绝，需要先适配与回归验证。单双面和 SMT/通孔类别按封装属性生成章节。每面 SMT 为 7 秒，通孔插装为 3 秒；不猜通孔焊接方式。典型顶面 SMT + 通孔插装为 44 秒；双面 SMT 为 48 秒。

已有 STEP 时仍可运行：

```powershell
npm run cad -- render "released-assembly.step" --pcb "matching-board.kicad_pcb" `
  --out exports/cad/manufacturing --width 1920 --height 1080 --fps 30 --azimuth=-45
npm run cad -- serve exports/cad/manufacturing --port 3104
```

`--pcb` 开启制造影片：整板旋转 → 分层爆炸 → 展开实际内铜层进行蚀刻示意 → 从下到上逐层压合 → 钻孔/孔金属化 → 外层蚀刻 → 阻焊 → 丝印 → 按实际封装属性进行锡膏/SMT/回流及通孔插装 → 原始 STEP 成品。`--duration` 可改变整段播放时长。输出仍为 `turntable.mp4`，另有 `exploded.png`、`manufacturing.json` 与原生锡膏绘图 `paste-source/`。

需要 KiCad 10 及其 `pcbnew` Python。默认从 KiCad CLI 同目录查找解释器；可通过 `--kicad-python PATH` 指定。只支持具有明确叠层厚度和 KiCad 命名节点的发布版装配 STEP；校验器件位置（含源模型偏移）以及板体厚度是否与 PCB 匹配。没有明确的分组或叠层就停止。盲埋孔暂不支持，会明确拒绝；不猜孔跨层范围。

铜层、钻孔、板框通过 KiCad 原生轮廓引擎提取，使用源文件已有的覆铜填充，不擅自重新填充。锡膏开口通过 KiCad 原生 SVG 制造绘图读取，包含局部间隙、比例、异形焊盘和填充图形；当前遇到未支持的描边锡膏图形会停止。阻焊、丝印、器件直接读取发布 STEP 的明确节点。初始/最终装配保留原始几何，首尾坐标及乱序跳转复位有浏览器检查。

爆炸间距、分层的展示颜色、压合动作、蚀刻扫描、锡膏显示厚度及回流光效都是工艺表达，不是生产设备、热场或焊点形状的仿真。制造参数不足时不会补造真实焊点。已有 STEP 遗漏声明器件时默认停止；只有用户明确接受部分影片后才允许 `render existing.step --pcb matching.kicad_pcb --allow-incomplete-step`，保留影片中的逐项缺件标注。`manufacture` 始终严格，不接受该开关。

已有 STEP 的部分展示必须逐项记录缺件，不能称为完整装配。用户确认接受缺件后才可使用上述显式开关。

```powershell
# 分阶段静帧和首尾/乱序跳转装配复位验证（需先启动 serve）
npm run cad:stages -- exports/cad/manufacturing http://127.0.0.1:3104
npm run cad:smoke -- exports/cad/manufacturing http://127.0.0.1:3104
.venv-cad/Scripts/python.exe packages/cad/scripts/review_video.py exports/cad/manufacturing/turntable.mp4 `
  --ffmpeg node_modules/@remotion/compositor-win32-x64-msvc/ffmpeg.exe `
  --out exports/cad/manufacturing/review --all-frames
```

## PCB 模型路径：缺失即停止

```powershell
npm run cad -- audit "board.kicad_pcb" --out exports/cad/audit
npm run cad -- render "board.kicad_pcb" --out exports/cad/board `
  --define "MY_MODELS=E:/PCB/models" `
  --define "KICAD8_3RD_PARTY=C:/Users/YourName/Documents/KiCad/10.0/3rdparty"
```

读取板中每个 `(model ...)` 的明确路径；支持 `${VAR}`、`$(VAR)`、`KIPRJMOD`、相对路径、项目 `.kicad_pro` 的文本变量、进程环境和 KiCad 配置路径。标准库默认目录从实际 KiCad 安装发现。`--define` 优先于配置；不会自行把 KiCad 8/9 的变量映射成 KiCad 10。

如果模型已移动，可提供明确映射：

```json
{
  "${MY_OLD_MODELS}/actual-part.step": "E:/PCB/models/actual-part.step"
}
```

`render`、`reference` 和 `manufacture` 默认先按封装精确型号自动补模；自动修复仍无法满足时会非零退出。`--no-auto-models` 可关闭自动行为并直接按严格模式审计。没有模型声明的机械孔会被识别并跳过；电气封装若没有精确 MPN/LCSC 或无法取得真实放置变换，则停止。

## JLC3D 精确模型获取

发布包包含不依赖 GUI 的 JLC3D 接口封装。查询关键字可以是 PCB 封装的准确器件型号，也可以是 LCSC 编号。先检查本机工具、配置和下载目录：

```powershell
npm run cad:jlc -- --doctor
npm run cad:jlc -- --help
# 解析但不下载
npm run cad:jlc -- STM32F103C8T6 --package LQFP-48 --dry-run --json
# 下载到项目内，避免污染全局库
npm run cad:jlc -- STM32F103C8T6 --package LQFP-48 --out exports/cad-models
```

脚本发现顺序为 `JLC3D_DOWNLOADER` → `JLC3D_HOME`/`~/.jlc3d/config.ini` → 常见 Downloads/Desktop/Documents/Program Files/Applications 目录。接口链与本地 JLC3D 下载器一致：

```text
POST /eda/product/search              keyword=<MPN or LCSC>
POST /devices/searchByIds             uuids[]=<hasDevice>
POST /components/searchByIds?forceOnline=1  uuids[]=<3D Model UUID>
GET  modules.lceda.cn/.../<model>
```

基础地址为 `https://pro.lceda.cn/api`。这是第三方在线服务，可能要求代理、改变或限制访问；请求带重试，元数据与 STEP 默认缓存在输出目录 `.jlc-cache/`，已验证模型可离线复用。失败时保留错误，不得用相似模型冒充。下载结果必须是 `ISO-10303-21` STEP，脚本记录来源、SHA-256、`3D Model Transform` 和 `jlc3d-models.json`。

脚本要求精确型号/编号匹配；同型号存在多个封装候选时用 `--package` 消除歧义，仍不唯一就停止。模型修复分为两类：

- 已声明但缺失：下载同 LCSC 型号，通过显式 `--model-map` 映射回原声明，保留原 offset/rotate/scale。
- 未声明可见模型：从 PCB 封装的 `Value`、`MPN`、`Manufacturer Part`、`Part Number`、LCSC 等字段取得准确型号，优先从 JLC 补齐；JLC 九元组 `sx,sy,sz,rz,rx,ry,ox,oy,oz` 与实测 STEP 包围盒共同生成 KiCad scale/rotate/offset。仅修改项目内临时 PCB/局部封装副本，不修改原始 PCB、`.kicad_sym` 符号库或共享 `.pretty` 封装库。无法确认型号、封装或变换时停止。

`model-repair.json` 记录原始/副本 PCB 哈希、模型 URL、SHA-256、放置参数、跳过项和失败项，并声明模型来源为“嘉立创EDA/EasyEDA官方库”及 https://lceda.cn/、https://easyeda.com。`easyeda2kicad` 可用于人工核对元数据，但本工具不借此修改共享符号库。JLC 无同型号模型时才考虑原厂 STEP；通用封装模型只能作为明确标注的近似展示，不能通过完整还原验收。

## 数据如何进入渲染器

PCB 路线：审计引用及文件 → 仅替换副本中的模型路径为绝对路径 → KiCad 原生 VRML 导出 → Three.js 导入 → GLB → WebGL2 拍摄。板体、钻孔、铜、阻焊、丝印、器件 STEP/WRL 及底面翻转/offset/scale/rotate 均由 KiCad 处理。没有调用旧版 `parts.ts` 的外形推测。未知或外部 VRML 节点会拒绝转换。

STEP 路线：原生 OpenCascade STEPCAF/XCAF 读取 → 每个装配定义独立网格化 → 检查每个 BRep 面 → OpenCascade GLB 导出。保留装配引用、位置、CAD 颜色及原文件拥有的透明度。逐实例检查导出三角面总数，避免转换器返回“成功”却丢掉几何。默认线性网格参数为 0.02 mm，角度参数为 0.25 rad；`--deflection` 可调整线性参数。这是曲面离散化设置，不是经过认证的误差上限。

几何与装配取自源文件。不同渲染器的灯光、色调映射和表面反射表现不保证与 KiCad 像素一致；STEP 只给颜色而未给物理材质时，统一使用明确的中性显示材质，不推断金属/塑料。若需要 KiCad 自己的原始外观，使用下面的参考渲染命令。

```powershell
npm run cad -- reference "board.kicad_pcb" --out exports/cad/reference
```

生成 KiCad 原生正面、背面、斜视 PNG 和日志。也执行同样的缺失检查。

整板 STEP 只包含作者当时导出的内容：没有导出的器件、丝印或铜层无法从 STEP 恢复。此工具不会补造这些内容，也不会把渲染结果称为实物测量。

## 验证

```powershell
npx tsc --noEmit
npx eslint packages/cad
$env:CAD_REQUIRE_NATIVE_TESTS='1'
npx vitest run packages/cad
npm run cad -- render fixtures/cad/assembly.kicad_pcb --out exports/cad/assembly-test
npm run cad -- reference fixtures/cad/assembly.kicad_pcb --out exports/cad/assembly-reference
```

单元/集成验证覆盖缺失即失败、精确映射、原文件不修改、路径变量循环、字符串保留、VRML 变换/透明度/单位往返，以及 STEP 装配实例位置与逐面颜色。没有安装可选原生 STEP 环境时，该集成测试跳过；设置 `CAD_REQUIRE_NATIVE_TESTS=1` 会要求它实际通过。

`fixtures/cad/assembly.kicad_pcb` 是专门的测试板：真实 KiCad 库 STEP 器件，正/反面、不同装配角度、模型偏移/旋转和非等比缩放，以及铜线、钻孔和两面文字。`colored-assembly.step` 是脚本生成的显式测试 CAD，两次装配同一已知尺寸彩色零件；它不用于替代用户板上的任何器件。

## 第三方依赖

Three.js、esbuild 使用 MIT 许可；Playwright 使用 Apache-2.0。STEP 运行时使用 `cadquery-ocp-novtk` / OpenCascade，按其 LGPL 2.1 与 OpenCascade exception 条款使用；运行时独立安装，没有把其二进制重新打包进本仓库。KiCad 通过用户安装的 CLI 调用。各依赖保持原许可，GLB/视频中的 CAD 设计和模型遵守输入文件自己的许可。完整说明见 [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md)。
