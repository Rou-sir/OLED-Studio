#include "oled_ui.h"
int use_generated_ui(U8G2 &display)
{
    return oled_ui_draw(display, OLED_UI_DEFAULT_PAGE);
}
int use_generated_full(U8G2 &display) {
    display.clearBuffer();
    if (!oled_ui_draw(display, OLED_UI_DEFAULT_PAGE)) return 0;
    display.sendBuffer();
    return 1;
}
int use_generated_paged(U8G2 &display) {
    display.firstPage();
    do { if (!oled_ui_draw(display, OLED_UI_DEFAULT_PAGE)) return 0; } while (display.nextPage());
    return 1;
}
