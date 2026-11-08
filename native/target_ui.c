#include "target_ui.h"

extern const uint8_t oled_custom_font[];
static const uint8_t icon[] U8X8_PROGMEM = {0x55, 0x15, 0xaa, 0x0a, 0xff, 0x1f};

int oled_ui_draw(u8g2_t *display, unsigned page)
{
    if (!display || page != 0) return 0;
    u8g2_SetDrawColor(display, 0);
    u8g2_DrawBox(display, 0, 0, 128, 64);
    u8g2_SetDrawColor(display, 1);
    u8g2_DrawFrame(display, 0, 0, 128, 64);
    u8g2_SetBitmapMode(display, 1);
    u8g2_DrawXBMP(display, 2, 2, 13, 3, icon);
    u8g2_SetFont(display, oled_custom_font);
    u8g2_SetFontRefHeightAll(display);
    u8g2_SetFontPosBaseline(display);
    u8g2_SetFontMode(display, 1);
    u8g2_SetFontDirection(display, 0);
    /* Explicit UTF-8 bytes keep the test independent of compiler source encodings. */
    u8g2_DrawUTF8(display, 2, 25, "\346\270\251\345\272\246\357\274\23225\342\204\203");
    return 1;
}
