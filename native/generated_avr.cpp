#include <avr/io.h>
#include <string.h>
#include "oled_ui.h"

#if OLED_UI_WIDTH != 128 || OLED_UI_HEIGHT != 64
#error "This ATmega328P acceptance fixture uses a 128x64 display"
#endif
static U8G2 display;
static u8x8_display_info_t info;
static uint8_t framebuffer[1024];
static void send_byte(uint8_t byte)
{
    while (!(UCSR0A & (1 << UDRE0))) {}
    UDR0 = byte;
}
int main(void)
{
    unsigned index;
    UBRR0 = 8; UCSR0B = 1 << TXEN0; UCSR0C = (1 << UCSZ01) | (1 << UCSZ00);
    memset(display.getU8g2(), 0, sizeof(u8g2_t)); memset(&info, 0, sizeof(info));
    info.tile_width = 16; info.tile_height = 8;
    info.pixel_width = 128; info.pixel_height = 64;
    display.getU8g2()->u8x8.display_info = &info;
    u8g2_SetupBuffer(display.getU8g2(), framebuffer, 8, u8g2_ll_hvline_vertical_top_lsb, U8G2_R0);
    if (oled_ui_draw(display, (OledUiPage)-1) || oled_ui_draw(display, (OledUiPage)32767) ||
        !oled_ui_draw(display, OLED_UI_DEFAULT_PAGE)) { send_byte(0xff); for (;;) {} }
    send_byte(0x4f); send_byte(0x4c);
    for (index = 0; index < sizeof(framebuffer); index++) send_byte(framebuffer[index]);
    for (;;) {}
}
