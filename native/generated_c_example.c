#include "oled_ui.h"
int use_generated_full(u8g2_t *display) {
    if (!display) return 0;
    u8g2_ClearBuffer(display);
    if (!oled_ui_draw(display, OLED_UI_DEFAULT_PAGE)) return 0;
    u8g2_SendBuffer(display);
    return 1;
}
int use_generated_paged(u8g2_t *display) {
    if (!display) return 0;
    u8g2_FirstPage(display);
    do { if (!oled_ui_draw(display, OLED_UI_DEFAULT_PAGE)) return 0; } while (u8g2_NextPage(display));
    return 1;
}
