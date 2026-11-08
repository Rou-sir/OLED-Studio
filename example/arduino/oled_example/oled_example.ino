#include <Arduino.h>
#include <U8g2lib.h>
#include <Wire.h>
#include "oled_ui.h"

#if (OLED_UI_ROTATION == 90 || OLED_UI_ROTATION == 270)
#if OLED_UI_WIDTH != 64 || OLED_UI_HEIGHT != 128
#error "This example requires a physical SSD1306 128x64 display"
#endif
#else
#if OLED_UI_WIDTH != 128 || OLED_UI_HEIGHT != 64
#error "This example requires a physical SSD1306 128x64 display"
#endif
#endif

#define OLED_ROTATION (OLED_UI_ROTATION == 90 ? U8G2_R1 : OLED_UI_ROTATION == 180 ? U8G2_R2 : OLED_UI_ROTATION == 270 ? U8G2_R3 : U8G2_R0)
#if OLED_UI_FULL_BUFFER
U8G2_SSD1306_128X64_NONAME_F_HW_I2C display(OLED_ROTATION, U8X8_PIN_NONE);
#else
U8G2_SSD1306_128X64_NONAME_1_HW_I2C display(OLED_ROTATION, U8X8_PIN_NONE);
#endif

static void show_page(OledUiPage page)
{
#if OLED_UI_FULL_BUFFER
    display.clearBuffer();
    if (!oled_ui_draw(display, page)) {
        Serial.println(F("OLED UI: invalid page"));
        return;
    }
    display.sendBuffer();
#else
    display.firstPage();
    do {
        if (!oled_ui_draw(display, page)) {
            Serial.println(F("OLED UI: invalid page"));
            return;
        }
    } while (display.nextPage());
#endif
}

void setup()
{
    Serial.begin(115200);
    display.setI2CAddress(0x3C << 1);
    display.setBusClock(100000);
    display.begin();
    Wire.beginTransmission(0x3C);
    const uint8_t error = Wire.endTransmission();
    if (error) {
        Serial.print(F("OLED I2C probe failed: "));
        Serial.println(error);
        for (;;) delay(1000);
    }
}

void loop()
{
    static unsigned int page = (unsigned int)OLED_UI_DEFAULT_PAGE;
    show_page((OledUiPage)page);
    page = (page + 1) % OLED_UI_PAGE_COUNT;
    delay(2000);
}
