# OLED Studio：AI 页面生成与项目文件调用说明

本文面向需要自动生成页面的 AI 和脚本。以当前实现的 `schemaVersion: 1` 为准。目标输出是**可以导入 OLED Studio 的完整 ZIP 项目包**，不是网页截图、PNG 页面或直接调用 Canvas 画图。

## 1. 文件实际上怎样保存

| 用途 | 形式 | 内容 |
|---|---|---|
| 授权目录自动保存 | `project.oled.zip` | 项目清单、图片/字库二进制、可选原始源文件 |
| 下载项目包 | 同样的 ZIP 格式 | 可独立恢复编辑，不依赖本机绝对路径 |
| 浏览器恢复/项目卡片 | IndexedDB `oled-studio-v1`，版本 2 | `projects` 存项目包和可选目录句柄；`catalog` 存卡片元数据；`state` 存当前项目 ID |
| 导出 UI 代码 | `oled-ui-arduino.zip` / `oled-ui-esp-idf.zip` / `oled-ui-stm32-hal.zip` | 仅 C++ / C UI 源码和头文件、实际引用的资源；许可保留在源码注释，不包含 JSON 或示例；不能当作设计项目包导入 |

项目 ZIP 的根目录结构：

```text
project.json
resources/<资源ID>.bin
sources/<资源ID>.bin       # 可选：PNG/JPEG/BMP、TTF/OTF 或电脑字体源字节
```

这里的 `/` 是 **ZIP 内部路径分隔符**，不是 Windows 文件系统路径。不能把所有内容套在一个额外目录里；不能放入 README、PNG 预览、目录条目或其他未声明文件。无资源项目可以只有 `project.json`。

清单是 UTF-8 JSON。图片与字体不在 JSON 中内嵌 Base64，而是以独立 `.bin` 文件保存，并在资源描述中声明精确长度和小写 SHA-256。浏览器缓存不是磁盘备份；只有写入流关闭成功才显示磁盘已保存。

**导入是恢复完整快照，不是合并。** 同项目 ID 导入保留当前目录绑定，可能自动写回该目录；不同项目 ID 导入解除旧目录绑定。新设计请创建新项目 ID；修改旧项目先备份。选择已有项目目录会打开磁盘中的快照，不是把当前设计强制覆盖过去。

## 2. 最短生成流程

1. 按下面格式生成项目 JSON；使用唯一 ID、整数像素坐标，写全必填属性。
2. 默认页面 ID 必须指向实际页面。组件数组从前到后依次绘制，后面的覆盖前面的。
3. ASCII 文字直接引用内置字体，无需字体资源。中文必须使用真实 U8g2 压缩字库，不能把 TTF 文件充当它。
4. 用本目录的打包脚本把清单与资源变成 ZIP；脚本计算字节长度和 SHA-256。
5. 在 OLED Studio 首页点击“导入项目包”，确认页数/组件数，检查各页预览和诊断，再保存或导出代码。

无需安装 Python 第三方包：

```powershell
# 在项目根目录运行；Python 3.10+
python .\docs\examples\pack_ai_project.py `
  --input .\docs\examples\ai-project.json `
  --output .\docs\examples\ai-demo.oled.zip
```

示例包含两页、ASCII、线条、矩形、圆、三角形、多边形和 13×3 图片。不依赖外部字体；它不伪造中文字库。可以让 AI 修改示例 JSON 后再次打包。**只将打包结果 ZIP 导入设计器，不直接导入 JSON。**

已提供 [可直接导入的示例项目包](examples/ai-demo.oled.zip)。该脚本生成的包已通过真实解析器与浏览器文件导入；Monitor 页 8 个组件、Shapes 页 5 个组件，两页原生预览均无裁剪/缺资源诊断，官方打包往返数据一致。脚本的路径输入重打包、非法行尾位、重复 ID 与非法路径拒绝也已验证。未进行真实硬件运行测试。

## 3. 项目与页面格式

所有列出的顶层字段必填：

```json
{
  "schemaVersion": 1,
  "id": "project-example",
  "name": "Temperature Monitor",
  "description": "AI generated static UI",
  "createdAt": "2026-11-08T00:00:00.000Z",
  "modifiedAt": "2026-11-08T00:00:00.000Z",
  "display": {
    "width": 128,
    "height": 64,
    "rotation": 0,
    "coordinateBits": 16,
    "bufferMode": "full",
    "controller": "SSD1306"
  },
  "pages": [
    {
      "id": "page-home",
      "name": "Home",
      "codeName": "home",
      "background": 0,
      "components": []
    }
  ],
  "defaultPageId": "page-home",
  "resources": []
}
```

- ID：1–80 字符，正则 `^[a-zA-Z0-9][a-zA-Z0-9_-]*$`。项目、全部页面、全部组件、全部资源之间必须**全局唯一**，不是只在一页内唯一。建议 UUID 或加前缀的 ID。
- 名称/说明是普通数据，允许中文，但不能包含 NUL；一般字符串上限 4096 个 JavaScript UTF-16 单元，时间字段上限 40。时间建议用 UTC ISO 8601，修改时更新 `modifiedAt`。
- `width`、`height` 是物理屏幕尺寸，各 1–512 整数；`rotation` 只能为 0/90/180/270。90/270 时逻辑画布宽高交换。
- `coordinateBits` 使用 **16**。8 可以记录，但当前正式代码导出会拒绝；不可承诺 8 位与预览一致。
- `bufferMode` 为 `"full"` 或 `"page"`；`controller` 是备注，不会自动生成驱动。
- `background` 为数字 0 或 1。至少一页；首屏卡片和导入后的初始页面使用 `defaultPageId`，不是 `pages[0]` 的隐式约定。
- 页面无独立尺寸。方向由设备初始化配置一次，组件坐标已是逻辑画布坐标。
- 页面可带独立 `codeName`，1–64 位 ASCII 字母/数字/下划线，字母开头，不含连续下划线，项目内不区分大小写唯一。显示 `name` 可中文；`codeName:"home_screen"` 导出 `oled_ui_page_home_screen()` 和 `OLED_PAGE_HOME_SCREEN`，ID 仍用于项目引用。新项目/页面默认 `page1`、`page2`；旧项目缺省时按页面顺序分配未占用的 `pageN`，建议设置并保存以固定名称。修改代码名称后需同步更新固件调用，替换旧导出文件。

## 4. 八类组件：完整属性与坐标

每个组件都要包含：

```json
{"id":"component-example","name":"rect 1","type":"rect","visible":true,"locked":false,"bit":1}
```

上面仅为公共部分，不能独立使用；还需按类型补齐下表属性：

| `type` | 额外必填属性 | 解释 |
|---|---|---|
| `line` | `points:[[x1,y1],[x2,y2]]` | 两个绝对画布顶点；没有 `fill` |
| `rect` | `x,y,width,height,radius,fill` | x/y 为左上角；宽高各 1–512；radius 为 0 到 `floor(min(width,height)/2)`；fill 布尔 |
| `circle` | `x,y,radius,fill` | x/y 为**圆心**；radius 为 1–512 整数；不是左上角 |
| `triangle` | `points:[[x1,y1],[x2,y2],[x3,y3]],fill` | 三个绝对坐标顶点，不能共线 |
| `polygon` | `points:[[x,y],...],fill` | 3–256 顶点；简单凹/凸多边形，不支持自交、孔洞或退化图形；不要再重复末尾起点 |
| `ascii` | `x,y,text,fontId,align,lineGap,transparent` | 文字规则见下一节 |
| `chinese` | `x,y,text,fontId,align,lineGap,transparent` | 必须绑定覆盖所用字符的真实字库 |
| `image` | `x,y,resourceId,transparent` | 左上角与项目图片资源 ID；尺寸来自资源，不要写组件 width/height 来缩放 |
| `point` | `x,y` | 单个像素 |
| `hline` / `vline` | `x,y,length` | 起点与 1–512 整数长度，向右 / 向下 |
| `ellipse` | `x,y,rx,ry,fill` | 圆心、水平与垂直半径（各 1–512 整数） |
| `arc` / `sector` | `x,y,radius,startAngle,sweepAngle` | 圆心、半径 1–512；起始角度 0–359、扫过角度 1–360 整数。0° 向右，逆时针；圆弧按 U8g2 256 级量化；扇形按最多 3° 三角形分段，360° 用实心圆 |
| `progress` | `x,y,width,height,min,max,value,vertical,border` | 左上角，宽高 3–512；min/max/value 整数 ±1000000，max > min，value 在范围内；vertical/border 布尔。纵向从底部填充，当前为静态值 |
| `battery` | `x,y,width,height,value,charging` | 左上角，宽 8–512、高 7–512，电量整数 0–100，charging 布尔；右侧电池帽，充电标记自动反色 |

坐标/顶点均为 -2048–2048 **整数**。越界图形按画布边缘裁剪且提示，不会自动缩放。`visible`、`locked`、`fill`、`transparent` 必须是 JSON 布尔值，不能用 0/1 或字符串；`bit` 必须是数字 0/1。隐藏不绘制/导出，锁定不限制渲染。

黑底通常用 `background:0`、`bit:1`。白底通常用 `background:1`、`bit:0`。XOR 颜色 2 不支持。线宽固定 1 像素，不支持对象任意旋转、透明度、渐变、事件或运行时变量绑定。

自定义字库的 `name` 同时决定导出 C 符号，推荐 `status_font` 这样的英文名称（导出为 `oled_font_status_font`）。文件扩展名 `.ttf/.otf/.c/.h/.bin` 会去除，空格/点/连字符转下划线，非 ASCII 字符转 `u` 加 Unicode 十六进制编码；连续下划线合并。重名按项目资源顺序追加 `_2` 等未占用序号，避免与其他资源的原始名称冲突。项目内部仍通过 `id/fontId` 引用，不因改名断开。生成与 UI 导出的字库 C 数组按真实字形记录添加字符及 Unicode 注释，压缩字节不变；内置 U8g2 字体仍使用官方符号。

图片 `name` 也决定导出符号：`battery_icon.png` → `oled_bitmap_battery_icon`，去除 `.png/.jpg/.jpeg/.bmp/.xbm/.c/.h/.bin`；字符编码与重名分配沿用同一规则。字库与图片使用不同前缀，可以同名。单独 XBM 下载以该符号命名，宽高宏为 `<符号>_width/_height`、数组为 `<符号>_bits`；UI 导出数组使用符号本身。内部仍通过 `resourceId` 引用，改名不修改位图或组件绑定。

**不要省略必填属性期待默认值，也不要发明属性**（`fontSize`、`color`、`rotation`、`zIndex`、`children` 等）。未知字段不构成扩展接口，导入规范化后可能丢弃。

### 4.1 文字：不要把 y 当成 U8g2 基线

```json
{
  "id":"text-title",
  "name":"ascii 1",
  "type":"ascii",
  "visible":true,
  "locked":false,
  "bit":1,
  "x":64,
  "y":4,
  "text":"STATUS",
  "fontId":"builtin-6x10",
  "align":"center",
  "lineGap":2,
  "transparent":true
}
```

- `y` 是文字布局顶部。实际基线 = `y + U8g2 ascent`；不要手动加字号当 y。
- `x` 是对齐锚点：left 左边界、center 中心、right 右边界。
- `align` 只能为 `"left"` / `"center"` / `"right"`。
- `lineGap` 是行间额外像素，0–128 整数。下一行基线间距 = ascent − descent + lineGap。
- `text` 最长 16384 UTF-16 单元；显式 `\n` 换行，没有自动换行。
- 三平台生成源码以 UTF-8 保存，文字直接写为 `"中文"`，仅转义 C 字符串必要的引号、反斜杠、控制字符，并防止旧 C 三字符组预处理；编译器源文件及执行字符集应设为 UTF-8，不再依赖全字节八进制转义。
- `ascii` 只接受 U+0020–U+007E 和换行；不能放中文、制表符或 `℃`。
- `transparent:true` 仅画字形；false 使用 U8g2 不透明文字背景。
- 字形宽度/ascent/descent以真实 U8g2 为准，不是电脑系统字体度量。

三种内置字体直接使用下列 ID；不能用 C 字库符号代替 `fontId`：

| `fontId` | U8g2 符号 | 用途 |
|---|---|---|
| `builtin-5x7` | `u8g2_font_5x7_tr` | 小号等宽 ASCII |
| `builtin-6x10` | `u8g2_font_6x10_tr` | 中号等宽 ASCII |
| `builtin-9x15` | `u8g2_font_9x15_tr` | 大号等宽 ASCII |

任意字号须生成/导入其他字体资源，不能在文字组件上指定字号缩放内置字体。中文资源也可包含 ASCII，但须检查真实覆盖表。

## 5. 图片资源与 XBM 位序

**ZIP 内 `project.json` 的最终描述格式：**

```json
{
  "id":"image-icon",
  "kind":"image",
  "name":"icon",
  "license":"Original artwork",
  "width":13,
  "height":3,
  "dataPath":"resources/image-icon.bin",
  "dataLength":6,
  "dataHash":"由打包脚本计算的64位小写十六进制SHA-256"
}
```

示意 hash 不是合法文件内容；让脚本计算，不要照抄。该资源对应组件：

```json
{
  "id":"image-component",
  "name":"image 1",
  "type":"image",
  "visible":true,
  "locked":false,
  "bit":1,
  "x":108,
  "y":5,
  "resourceId":"image-icon",
  "transparent":true
}
```

标准位图是**逐行、LSB-first、每行单独补齐字节**：

```text
stride = ceil(width / 8)
offset = y * stride + floor(x / 8)
mask   = 1 << (x % 8)
pixel  = (data[offset] & mask) != 0
长度   = stride * height
```

例如 13×3，两边竖线 `x=0`、`x=12` 为亮点：

```text
十进制字节：[1,16, 1,16, 1,16]
十六进制：  01 10 01 10 01 10
```

这不是 U8g2 屏幕缓冲的垂直页序。最后一个字节中的未使用高位必须清零。不要把 PNG 文件内容直接作为 `resources/*.bin`，也不能把一整行之外的像素连续打包而忽略行补齐。

`transparent:true` 只绘制亮位；false 时零位也按 U8g2 bitmap 背景规则绘制。`bit` 是绘制颜色，不等同于修改资源二进制。

可选源图元数据：

```json
{
  "sourcePath":"sources/image-icon.bin",
  "sourceLength":123,
  "sourceHash":"由脚本计算",
  "sourceType":"image/png",
  "sourceName":"icon.png",
  "options":{
    "x":0,"y":0,"cropWidth":13,"cropHeight":3,
    "width":13,"height":3,"threshold":128,
    "invert":false,"background":0,"dither":false
  }
}
```

以上字段合并到图片资源描述中；省略源文件与 options 仍能显示/导出图片，也能在绘制模式重新编辑。手工绘制保存的是裁掉外围空白后的图片，内部间隙保留；不要期待保留工作区上的原始位置。

## 6. 中文与自定义字库：推荐复用已有模板

最可靠流程：

1. 在设计器字库工具中选择源字体，收集 AI 要显示的全部字符，设字号/阈值，生成资源。
2. 下载项目包作为模板，解压到本地。
3. AI 修改 `pages` 与 `components`，原样保留字体资源描述及资源文件；绑定 `fontId` 为资源 `id`。
4. 重新打包；补新字时必须重新生成字库，不是只改 `coverage`。

字体资源描述：

```json
{
  "id":"font-chinese",
  "kind":"font",
  "name":"Chinese 16px",
  "license":"填写实际来源及许可",
  "coverage":[20013,25991],
  "size":16,
  "threshold":64,
  "dataPath":"resources/font-chinese.bin",
  "dataLength":80,
  "dataHash":"按真实字库字节计算"
}
```

长度 80 只是格式示例，不能当作任意字库的长度。`coverage` 为按真实字库解析得到的有序 BMP Unicode 码点，必须与字库字节**完全一致**。图片字节、TTF/OTF、BDF、C 源代码文本都不是这个 `.bin` 的内容；这里必须是 U8g2 压缩字库数组的实际字节。

```json
{
  "id":"text-chinese",
  "name":"chinese 1",
  "type":"chinese",
  "visible":true,
  "locked":false,
  "bit":1,
  "x":4,
  "y":20,
  "text":"中文",
  "fontId":"font-chinese",
  "align":"left",
  "lineGap":2,
  "transparent":true
}
```

可选 `sourcePath/sourceLength/sourceHash/sourceName` 保存源字体；`postscriptName` 保存电脑 TTC 中的精确成员。`size` 为 5–64 整数、`threshold` 为 0–255。无源字体仍可显示/导出，不能假装支持重新生成。当前不承诺非 BMP、复杂 shaping、可变/彩色字体。

**严禁 AI 编造压缩字库、哈希或覆盖表。** 没有字库时，请要求提供模板，或先生成 ASCII 版本并明确缺少中文资源。

## 7. 附带打包脚本的输入约定

`examples/pack_ai_project.py` 是参考打包器，Python 标准库，无安装步骤。它不代替设计器的字体位流、几何和渲染校验。

脚本接受项目 JSON，资源可以使用：

- `dataPath`：文件必须位于 `--assets` 根下的 `resources/<id>.bin`。不提供 `--assets` 时使用输入 JSON 所在目录。
- 或 `dataBytes:[0,1,...]`：脚本输入便利字段，整数 0–255；脚本将它移除并写成标准资源文件。**最终项目清单没有 dataBytes 字段。**
- 可选 `sourcePath`：位于同根下 `sources/<id>.bin`，脚本读取源文件。
- 可选 `sourceBytes`：与 dataBytes 相同的脚本便利字段。

脚本重新计算所有存在数据的长度/hash，检查文件路径、图片字节数、行尾高位、唯一 ID、资源总量和 ZIP 预算；不复制未声明文件。源图/源字体只是封装，不会自动取模/转换。

修改已有解压模板：

```powershell
python .\docs\examples\pack_ai_project.py `
  --input C:\work\oled-template\project.json `
  --assets C:\work\oled-template `
  --output C:\work\new-design.oled.zip
```

为避免误覆盖，输出已存在时脚本拒绝；有意替换须加 `--overwrite`。

## 8. 在本仓库中用真实 API 校验

已有构建环境可直接复用，不需要改设计器：

```powershell
.\tools\run.ps1 -Task build
```

Node ESM 中加载真实解析/打包模块（Windows 路径先转换为文件 URL）：

```js
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const api = await import(pathToFileURL(path.resolve("build", "project-package.mjs")).href);
const project = await api.unpackProject(new Uint8Array(await readFile("new-design.oled.zip")));
console.log(project.pages.map(page => ({ name: page.name, components: page.components.length })));
// project.resources[*].data/source 已是 Uint8Array，不是 ZIP 的资源描述对象。
// 修改项目后可用官方打包器重新输出；保留ID用于同项目更新，新设计应另用新ID。
await writeFile("validated-design.oled.zip", await api.packProject(project));
```

内存 `Project.resources` 使用 `data:Uint8Array` 和可选 `source:Uint8Array`；ZIP 清单资源使用路径/长度/hash。**不要混用这两种形态**，不要把 JSON 数字数组直接传给内存项目 API。

浏览器当前存在 `window.oledStudio` 诊断接口：`ready`、`project()`、`load(Project)`、`preview(paged?)`、`flush()`。`load` 需要内存形态资源，会切换到设计器，但不会单独完成磁盘保存；`flush` 只等待已排队保存。它是内部诊断接口，不是稳定公共 SDK。推荐长期集成走标准项目 ZIP 导入；程序化使用前检查接口和当前版本。

## 9. 如果“调用”是指设备上显示页面

AI 先输出项目包供编辑器导入，再从设计器导出 UI 代码。在“导出 UI 代码”弹窗选择 Arduino / ESP-IDF / STM32 HAL。三种包页面效果和资源像素相同，但源码 API 与图片存储声明不同；生成代码采用 U8g2 2.36.5 的 16 位构建：

| 平台 | 页面源码/实例 | 图片调用与存储 | 文字调用 |
|---|---|---|---|
| Arduino | `oled_ui.cpp` / `U8G2 &display` | `display.drawXBMP(...)` / `U8X8_PROGMEM` | `display.drawUTF8(...)` |
| ESP-IDF | `oled_ui.c` / `u8g2_t *ctx` | `u8g2_DrawXBM(ctx, ...)` / 普通 `const uint8_t` | `u8g2_DrawUTF8(ctx, ...)` |
| STM32 HAL | `oled_ui.c` / `u8g2_t *ctx` | `u8g2_DrawXBM(ctx, ...)` / 普通 `const uint8_t` | `u8g2_DrawUTF8(ctx, ...)` |

XBM 是普通内存读取，XBMP 在 AVR 上读取程序存储器；不能只改函数名而保留不匹配的存储声明。ESP32/STM32 的普通常量图片可直接寻址。字库不是 XBM 图片，三个目标仍保留 `U8G2_FONT_SECTION`，由 U8g2 字库接口读取。

Arduino：

```cpp
#include "oled_ui_arduino.hpp"

// display 由你的程序按真实控制器/引脚定义并 begin()。
display.clearBuffer();
oled_ui_draw(display, OLED_UI_DEFAULT_PAGE);
display.sendBuffer();

// 页缓冲改为：
display.firstPage();
do {
  oled_ui_draw(display, OLED_UI_DEFAULT_PAGE);
} while (display.nextPage());
```

ESP-IDF / STM32 HAL C：

```c
#include "oled_ui.h"

// display 为已初始化的 u8g2_t，不在此生成 HAL/驱动。
u8g2_ClearBuffer(&display);
oled_ui_draw(&display, OLED_UI_DEFAULT_PAGE);
u8g2_SendBuffer(&display);
```

Arduino 将 `oled_ui.cpp` 和 `oled_resources.c` 加入工程；ESP-IDF/STM32 HAL 使用 `oled_ui.c` 和 `oled_resources.c`。保留各包头文件，具体集成和独立硬件示例见 [example/README.md](../example/README.md)。ZIP 不含说明、CMake、JSON 或示例。替换旧包时移除旧页面源码，不能同时保留旧 `oled_ui.c` 和新 Arduino `oled_ui.cpp`。`oled_ui_arduino.hpp` 仍作为便利头保留，但不再转发整个页面到 C 核心。

页符号映射见导出 `oled_ui.h` 的枚举及注释；不是把页面字符串传给绘制函数。头文件同时有 `OLED_UI_ROTATION`、`OLED_UI_FULL_BUFFER`、`OLED_UI_PAGE_COUNT`，供固定示例适配可替换的 UI。`oled_ui_draw` 成功返回 1，无效页面或空 C 实例返回 0；调用方应检查返回值并处理错误，负责初始化、缓冲生命周期与刷新。页面绘制包含背景填充。需在真实硬件检查驱动、旋转、字体许可和内存占用。

## 10. 可直接交给其他 AI 的提示词

```text
你要为 OLED Studio 生成可编辑的 U8g2 单色页面。
请读取 docs/ai-project-guide.md 和 docs/examples/ai-project.json。
目标输出：符合 schemaVersion 1 的项目 JSON，以及通过
docs/examples/pack_ai_project.py 打包的 .oled.zip；不要仅给截图或 HTML。

屏幕：[填写，例如 128×64、rotation=0、coordinateBits=16]
页面需求：[逐页描述]
字体/图片模板：[填写提供的项目包位置；未提供则只用三种内置 ASCII 字体]

要求：
1. 所有必填字段、唯一 ID、整数坐标、明确 defaultPageId。
2. 按 components 数组顺序绘制，不使用未知的布局/字号/颜色字段。
3. 文字 y 是顶部，circle x/y 是圆心，image 尺寸来自资源。
4. 中文必须绑定真实覆盖所需字符的 U8g2 字库；不编造字节/哈希。
5. 图片逐行 LSB-first，每行补齐，尾部无效位清零。
6. 新设计用新项目 ID；保留模板原资源及实际许可。
7. 用脚本生成长度/hash，真实导入校验并检查裁剪、缺字与页面预览。
8. 给出生成的项目包路径和简短页面说明。
```

建议 AI 先完成一页、校验导入，再扩展多页。没有字体源/授权、没有验证环境或未检查预览时必须明确说明，不能声称硬件已验证。
