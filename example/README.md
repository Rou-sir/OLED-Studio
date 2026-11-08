# 三平台 OLED UI 调用示例

这里的实例是固定的硬件/应用部分；设计器导出的文件是可替换的 UI 部分。示例不会混入导出 ZIP。

## 共用配置

- SSD1306 128×64，四针 I2C 模块，7 位地址 `0x3C`，100 kHz。
- SDA/SCL 需要合适的上拉，电源与引脚电压必须与开发板兼容；默认不接独立 RESET。
- U8g2 2.36.5，**UI 和 U8g2 库都必须启用 `U8G2_16BIT`**，不能只在应用文件里临时定义。超过 32,760 字节的字库还需库侧一致启用 `U8G2_USE_LARGE_FONTS`。
- 设计项目物理尺寸设置为 128×64，旋转可以选择 0/90/180/270。示例按导出的 `OLED_UI_ROTATION`、`OLED_UI_FULL_BUFFER` 配置旋转/缓冲。
- 从默认页面开始，每 2 秒轮换页面；页面枚举、入口及 `OLED_UI_PAGE_COUNT` 见导出的 `oled_ui.h`。
- 项目资源可能超过 MCU Flash/RAM。Uno 建议选页缓冲，中文大字库尤其需要自行检查容量；全缓冲单帧就需要约 1 KB RAM。
- 每次重新导出，删除原 UI 文件再复制新包。不要混用旧 `oled_ui.c` 与新 Arduino `oled_ui.cpp`，也不要把不同平台的资源文件混在一起。
- 本轮没有安装编译环境、运行 MCU 编译或硬件测试。以下代码由你在自己的 SDK/工具链中测试。

## Arduino Uno

目录：[arduino/oled_example](arduino/oled_example)。SDA=A4，SCL=A5。

1. 将 **Arduino** 导出包全部解压到 `oled_example.ino` 同目录。
2. 在自己的 Arduino 环境中接入已配置好 16 位坐标的 U8g2 库，打开该 sketch。
3. 示例创建 SSD1306 硬件 I2C 实例并初始化；通过 Wire 探测设备，失败在串口输出错误并停止。调用 `oled_ui_draw(display, page)`，按项目的全/页缓冲刷新。
4. 串口 115200。U8g2 的 `sendBuffer` 无独立 I2C 错误返回；初始设备探测不代表持续通信监控。

## ESP32 / ESP-IDF

目录：[esp-idf](esp-idf)。SDA=21，SCL=22。使用 **ESP-IDF 5.2+ 新 I2C master API**，不与旧 `driver/i2c.h` 驱动混用。其他 ESP32 系列开发板须自行改引脚。

1. 将 **ESP-IDF** 导出包全部解压到 `esp-idf/components/oled_ui`，保留该目录已有的 `CMakeLists.txt`。
2. 在项目中提供名为 `u8g2` 的 C 组件，导出 `u8g2.h` 和实际 U8g2 库，并在该组件的编译配置中启用 `U8G2_16BIT`。若你的组件名不同，修改 `components/oled_ui/CMakeLists.txt` 中 `REQUIRES u8g2`。
3. 根 CMake 与 `main/CMakeLists.txt` 已提供。`main/main.c` 包括 `app_main`、I2C 总线/设备初始化、设备探测、U8g2 byte/GPIO-delay 回调和页面循环。
4. C 回调聚合 U8g2 的一次传输，包含原始控制字节；ESP-IDF 设备地址使用 **7 位** `0x3C`，不要再左移。驱动通信失败通过 `ESP_ERROR_CHECK` 报错并终止，不假装刷新成功。

## STM32 HAL / CubeMX

目录：[stm32-hal](stm32-hal)。硬件 I2C 使用 **`hi2c1`**，具体 SDA/SCL 由你的芯片和 CubeMX 配置决定。

1. 用自己的 CubeMX 工程提供 HAL、系统时钟、GPIO、100 kHz I2C1 和 `hi2c1`；`main.h` 必须能提供相应 HAL 类型/声明。不要仅复制示例便省略这些初始化。
2. 将 **STM32 HAL** 导出包的 `.c` 文件及 `oled_example.c` 加入编译，所有头文件加入 include 路径；接入实际 U8g2 C 库并一致启用 `U8G2_16BIT`。
3. 在 `main.c` 的 USER CODE include 区加入 `oled_ui.h` 和 `oled_example.h`，在 `MX_GPIO_Init()`、`MX_I2C1_Init()` 之后执行下方代码。不要替换 CubeMX 生成的整个 `main.c`。

```c
/* USER CODE BEGIN 2 */
if (!OLED_Example_Init()) {
    /* 可在调试器查看 OLED_Example_LastHalError()。 */
    Error_Handler();
    for (;;) {}
}
unsigned int oled_page = (unsigned int)OLED_UI_DEFAULT_PAGE;
/* USER CODE END 2 */

/* 放入已有 while (1) 的 USER CODE 循环区。 */
if (!OLED_Example_Draw(oled_page)) {
    Error_Handler();
    for (;;) {}
}
oled_page = (oled_page + 1) % OLED_UI_PAGE_COUNT;
HAL_Delay(2000);
```

示例用 `HAL_I2C_Master_Transmit`，HAL 地址使用左移后的 `0x3C << 1`。I2C 失败被锁存，初始化/绘制返回 0，调用方必须处理；`OLED_Example_LastHalError()` 可查看 HAL 错误码（非法页、未初始化或回调错误不一定产生 HAL 错误码）。初始化的亚毫秒延时保守扩大为 1 ms，非软件 I2C，不要求 DWT。不要从中断调用，多个任务应串行访问显示器。
