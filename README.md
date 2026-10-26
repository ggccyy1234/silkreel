# silkreel CAD — 真实 KiCad 装配与制造展示视频

本 fork 直接读取 KiCad 引用的 3D 模型或整板 STEP，生成旋转展示、分层爆炸和制造装配影片。器件外形、坐标、偏移、旋转、缩放和底面翻转由源 CAD 与 KiCad 原生导出决定，不按位号、焊盘或封装名猜模型。

**使用要求：必须使用能够读写项目文件、运行本地命令并查看渲染结果的 Agent 辅助工作。** 请让 Agent 阅读本文件、[AGENTS.md](AGENTS.md) 和 [CAD 使用说明](packages/cad/README.md)，完成输入审计、兼容性评估、逐帧检查及最终复核后交付。命令执行成功不等于成片正确，不能跳过检查直接把 MP4 当成完成品。

脚本运行本身不调用 LLM，不需要模型 API Key。Agent 负责环境配置、异常定位、适配和有证据的验收；几何数据必须来自 CAD，Agent 也不得补猜。

当前版本：`v0.1.0-cad.1`，Windows x64 预发布版。原作者的 trace/glyph 风格渲染器保留在源码中，其器件表达带有推测性；不用于本工具的真实 CAD 验收。原项目说明见 [UPSTREAM_README.md](UPSTREAM_README.md)。

## 获取与安装

从 [本 fork 的 Releases](https://github.com/ggccyy1234/silkreel/releases) 下载 `silkreel-cad-…-win-x64.zip` 并解压。它是预编译的本地命令行工具包，**不是免依赖 EXE 安装器**。也可克隆完整源码：

```powershell
git clone https://github.com/ggccyy1234/silkreel.git
cd silkreel
git checkout v0.1.0-cad.1
npm ci
```

解压的命令行包也先在其根目录运行 `npm ci`。环境要求：

| 依赖 | 用途 |
| --- | --- |
| Node.js 22+、npm | 执行命令行工具 |
| KiCad 10（含标准 3D 模型库、CLI、pcbnew Python） | PCB 审计、原生导出、制造轮廓提取 |
| Chrome / Edge / Chromium、WebGL2 | 本地画面渲染 |
| Python 3.10–3.13 + OpenCascade | STEP 转换；安装到包内 `.venv-cad` |
| Pillow | 完整视频解码后的检查图生成；随 `cad:setup` 安装 |
| FFmpeg / FFprobe | 编码和检查；Windows x64 包通过 npm 安装固定版本的 Remotion 编码依赖，也可指定路径 |

```powershell
# 用本机已有的 Python 创建独立环境；路径请替换
npm run cad:setup -- --python "C:/path/to/python.exe"
# 没有 Chrome/Edge 时才需要
npx playwright install chromium
npm run cad -- --help
```

依赖安装需要网络。CAD 数据与运行时渲染在本地处理，不上传到外部服务。输入文件只读；日志和输出可能含本地绝对路径，分享前需检查。

## 常用入口

```powershell
# 先审计，再做静态预览
npm run cad -- audit "board.kicad_pcb" --out exports/cad/audit
npm run cad -- manufacture "board.kicad_pcb" --out exports/cad/film --still

# 完整影片：真实 STEP 导出 → 分层制造 → 装配成品
npm run cad -- manufacture "board.kicad_pcb" --out exports/cad/film --azimuth=-45

# 仅展示原始装配，不演示制造；也接受整板 .step/.stp
npm run cad -- render "board.kicad_pcb" --out exports/cad/assembled
npm run cad -- render "assembly.step" --out exports/cad/step

# 用 KiCad 自己的渲染做参考对照
npm run cad -- reference "board.kicad_pcb" --out exports/cad/reference

# 本机查看器：拖动、正反面、旋转、下载 PNG/GLB
npm run cad -- serve exports/cad/film --port 3103
```

制造影片自动读取标题、叠层和封装属性，安排单双面 SMT 与通孔器件插装。典型顶面 SMT + 通孔器件为 44 秒、双面 SMT 为 48 秒。默认 1920×1080 / 30 fps；`--duration` 改变整段时长，不改变章节先后关系。输出包括 `turntable.mp4`、正反面及爆炸 PNG、`model.glb`、`manifest.json`、`manufacturing.json`、`audit.json`、源快照和逐帧报告。

## 兼容范围与不兼容情况的处理

以下限制针对 `manufacture` 与 `render STEP --pcb PCB` 的制造影片；仅渲染现有整板 STEP 不需要制造叠层。

| 情况 | 本版行为 | Agent 必须如何处理 |
| --- | --- | --- |
| 普通 4 / 6 铜层、贯穿孔、明确叠层 | 已有完整视频验证；仍需逐板检查 | 校验每层名称、厚度、顺序和 STEP 板体厚度；不能把一次通过当作所有板都通过 |
| 2 层、8 层及以上，或不规则叠层 | 发布入口拒绝 | 先适配时间线、逐层压合时长、镜头包围范围、内铜层排布及文字布局；新增样板与回归检查后才放开，不能仅删除限制或把层合并 |
| 盲孔、埋孔、微孔 / HDI | 非贯穿过孔拒绝；HDI 未验证 | 增加明确的逐层孔跨距和加工阶段表达，核对源数据；不得改成通孔冒充兼容 |
| 软板 / 刚柔结合、厚铜、金属基、多材料或多段介质 | 未验证或拒绝 | 根据真实 stackup/制造资料补实现；资料不足则停止制造影片，可改为已存在装配模型的展示 |
| 叠层缺厚度、顺序不明、铜层为空 | 停止 | 请设计者补齐真实资料；空铜层需要实现并验证空层语义，不得填满铜或默认 1.6 mm |
| 可见 3D 模型缺失、变量未解析 | 非零退出，保存审计 | 修复真实库路径或提供经过核对的 `--define` / `--model-map`；禁止找同名相似模型自动顶替 |
| 封装未声明可见模型 / 模型被隐藏 | 审计列出，保留源设置，不生造外形 | 逐项确认是否为安装孔、刻意隐藏或确实缺模；缺少真实器件时不得宣称完整还原 |
| WRL / VRML 器件 | 装配展示可走 KiCad VRML；自动制造 STEP 入口拒绝 | 取得该器件真实、可追溯的 STEP/IGES，并在设计者确认后显式映射；不要只改扩展名，也不要启用同名替换 |
| 不支持的 VRML 节点、损坏 STEP、无三角面的曲面 | 停止 | 定位原始模型或转换器问题，提供有效 CAD；不得删掉失败面后继续称完整 |
| STEP 与 PCB 位号、位置、厚度不匹配 | 停止 | 使用同一设计版本重新原生导出；不得自动平移、缩放或改厚度来凑齐 |
| 已有 STEP 遗漏器件 | 默认停止并列位号 | 优先获得完整 STEP。只有用户明确接受部分展示后，才可对已有 STEP 使用 `--allow-incomplete-step`；影片必须保留缺件标注。自动 `manufacture` 不允许该豁免 |
| 未填充覆铜、板框未闭合 | 停止 | 在 KiCad 中由设计者确认后修复/填充并另存；不得自动修改原 PCB 来掩盖错误 |
| 不支持的锡膏描边图形、特殊焊盘等 | 明确错误；复杂输入仍需比对 | 对照 KiCad 制造绘图增加精确转换与测试；不能用包围盒或简化焊盘代替开口 |
| 通孔器件焊接、压接、特殊回流或生产参数未知 | 仅展示实际器件插装，不推测工艺 | 资料足够时才能增加相应章节；插装展示不等于已模拟焊接 |

铜、孔和叠层来自保存的 PCB；丝印、阻焊和器件来自原生 STEP。爆炸距离、演示材质、扫描效果、锡膏显示厚度和回流光效是展示设定，**不是制造设备轨迹、热场、实际焊点或实物测量**。灯光与色调映射也不保证与 KiCad 像素一致。

## Agent 必须执行的检查项

### 1. 输入与来源

- [ ] 记录 PCB / project / STEP 的版本和 SHA-256，保留只读原件与输入快照；确认 PCB 和 STEP 来自同一版本。
- [ ] 审计每个模型的原始路径、解析路径、哈希、可见状态及 offset/scale/rotate；复核 `withoutModels` 与缺件清单。
- [ ] 确认环境、铜层数、真实介质厚度、阻焊颜色、覆铜已填充、孔跨层范围；先按上表处理不兼容情况。
- [ ] 遇到缺失、转换警告、未支持特性必须定位。不得吞掉错误、改成功状态、补猜模型或悄悄减少器件/板层。

### 2. 几何与静态预览

- [ ] 先执行 `--still`，查看 `cover.png`、`top.png`、`bottom.png`、`exploded.png` 和每一章节静帧。
- [ ] 与 KiCad 原生参考或设计者确认的 STEP 对照：板框、尺寸、孔径、焊盘、走线/覆铜、阻焊开窗、锡膏开口、丝印，以及所有器件的数量、朝向、上下表面和偏移。
- [ ] 检查 GLB 单位（米）、显示单位（毫米）、曲面网格化失败面与实例三角面数量；不能只看模型“看起来像”。
- [ ] 检查真实层顺序和厚度，确认每层都出现，逐层装配在下一工艺开始前完成，SMT 与通孔器件分类正确。

### 3. 全片与逐帧检查

- [ ] 渲染器对每一输出帧检查浏览器错误、可见 CAD 网格和投影包围范围，写入 `frame-audit.json`。核对检查帧数与 `duration × fps` 一致，且没有裁切、空几何或缺记录。该报告不能替代视觉检查。
- [ ] **完整解码全部视频帧并保存逐帧 PNG**；生成覆盖全片的至少 5 fps 接触表，逐张打开全部接触表，不允许只抽前中后三帧。低于 5 fps 的视频取全部帧。
- [ ] 逐帧核对 PNG；重点复核章节切换前后、爆炸极限、内层蚀刻、压合完成、翻面、器件落位及回流结束。排查黑帧、闪烁、跳变、穿模、浮空、缺面、遮挡、裁切、文字重叠和过小细节。自动成功只说明相应机械检查通过。
- [ ] 正常速度完整观看一次；检查节奏、停顿、动作连续性、首尾收束和说明是否容易理解。播放到 `ended` 只证明播放完成，不能冒充视觉验收。
- [ ] 检查首尾及乱序跳转时原始装配坐标复位；最终装配不应残留动画位移、裁切平面或演示铜箔。
- [ ] 用 FFprobe 确认实际分辨率、帧率、时长、帧数；再次完整解码验证没有损坏；确认预期是否含音轨。

检查命令（路径按输出目录和平台替换）：

```powershell
# 终端 1：启动查看器
npm run cad -- serve exports/cad/film --port 3103
# 终端 2：章节静帧、首尾与乱序复位；然后检查交互和全片播放
npm run cad:stages -- exports/cad/film http://127.0.0.1:3103
npm run cad:smoke -- exports/cad/film http://127.0.0.1:3103
# 完整解码、保存每帧、生成全片接触表（占用较多磁盘）
.venv-cad/Scripts/python.exe packages/cad/scripts/review_video.py exports/cad/film/turntable.mp4 `
  --ffmpeg node_modules/@remotion/compositor-win32-x64-msvc/ffmpeg.exe `
  --out exports/cad/film/review --all-frames
# 要让接触表也包含每一帧，可追加 --sheet-fps 30（应匹配实际 fps）
```

### 4. 交付与异常记录

- [ ] 在项目内保存检查记录：环境、命令、输入/成片哈希、失败与修复、全部检查图位置、逐帧与播放结论、已知缺件和限制。尚未做的检查必须标为未完成。
- [ ] 按 [AGENTS.md](AGENTS.md) 的视觉评分项记录证据。修复视觉问题后重新渲染并检查整片，不能只复查修好的单帧。
- [ ] 交付 MP4、封面、来源记录和限制说明；用户最终确认视觉效果。公开分享前确认设计、器件模型、截图和视频的授权，避免包含私有板卡和本机路径。

可以直接给 Agent 的任务：

> 请先读取 README.md、AGENTS.md 和 packages/cad/README.md。为我提供的 PCB 制作真实 CAD 制造影片，严格遵守兼容矩阵；禁止推测器件和板层。先审计、生成并核对所有静态视图，再渲染整片；保存每帧、检查所有接触表和每个工艺切换，完整播放并记录证据。遇到缺失模型或不支持特性时先定位，按文档适配或请求真实资料，不要绕过错误后宣称完成。

## 开发、打包和发布

```powershell
npx tsc --noEmit
npx eslint packages
$env:CAD_REQUIRE_NATIVE_TESTS='1'
npx vitest run packages/cad
npm run cad:package -- --out exports/releases/candidate
```

从压缩包解压到新的目录，执行 `npm ci`、帮助命令、合成 STEP 渲染和真实 PCB 制造回归，验证不依赖源码目录、已有缓存或开发者的 Python 环境。发布包用白名单组装，不包含 `node_modules`、Python 环境、第三方器件模型、私有 PCB、视频输出或私人参考素材。发布 ZIP 随附 SHA-256；固定依赖由 `package-lock.json` 管理。完整源码另由 GitHub tag 提供。

本版只声明 Windows x64 + KiCad 10 的实测状态；跨平台和更多层数需要各自完成适配与验收。变更见 [CHANGELOG.md](CHANGELOG.md)，许可证及依赖说明见 [LICENSE](LICENSE) 与 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
