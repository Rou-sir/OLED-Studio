#ifndef OLED_TARGET_ARDUINO_HPP
#define OLED_TARGET_ARDUINO_HPP
#include "U8g2lib.h"
#include "target_ui.h"

inline bool oled_ui_draw(U8G2 &display, unsigned page)
{
    return oled_ui_draw(display.getU8g2(), page) != 0;
}
#endif
