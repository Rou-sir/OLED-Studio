#include <cstdio>
#include <cstring>
#include "U8g2lib.h"
#include "renderer.h"

int main(int argc, char **argv)
{
    if (argc != 2 || !render_init(128, 64, 0)) return 2;
    U8G2 display;
    std::memcpy(display.getU8g2(), render_context(), sizeof(u8g2_t));
    display.setDrawColor(1);
    display.drawBox(3, 4, 10, 5);
    display.drawCircle(30, 15, 7);
    display.setFont(u8g2_font_6x10_tr);
    display.setFontRefHeightAll();
    display.setFontPosBaseline();
    display.setFontMode(1);
    display.drawUTF8(2, 45, "Bridge gyp");
    std::memcpy(render_context(), display.getU8g2(), sizeof(u8g2_t));
    FILE *output = std::fopen(argv[1], "wb");
    if (!output) { std::perror("C++ output"); return 1; }
    if (std::fwrite(render_pixels(), 1, 128 * 64, output) != 128 * 64) {
        std::fclose(output); return 1;
    }
    return std::fclose(output) != 0;
}
