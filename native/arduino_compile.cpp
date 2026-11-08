#include "target_arduino.hpp"

bool check_arduino_ui(U8G2 &display)
{
    return oled_ui_draw(display, 0);
}
