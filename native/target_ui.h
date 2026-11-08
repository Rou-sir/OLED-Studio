#ifndef OLED_TARGET_UI_H
#define OLED_TARGET_UI_H
#include "u8g2.h"

#ifdef __cplusplus
extern "C" {
#endif
int oled_ui_draw(u8g2_t *display, unsigned page);
#ifdef __cplusplus
}
#endif
#endif
