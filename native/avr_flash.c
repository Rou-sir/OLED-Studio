#include <avr/io.h>
#include <string.h>
#include "target_ui.h"

static u8g2_t display;
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
    UBRR0 = 8;
    UCSR0B = 1 << TXEN0;
    UCSR0C = (1 << UCSZ01) | (1 << UCSZ00);
    memset(&display, 0, sizeof(display));
    memset(&info, 0, sizeof(info));
    info.tile_width = 16;
    info.tile_height = 8;
    info.pixel_width = 128;
    info.pixel_height = 64;
    display.u8x8.display_info = &info;
    u8g2_SetupBuffer(&display, framebuffer, 8, u8g2_ll_hvline_vertical_top_lsb, U8G2_R0);
    if (!oled_ui_draw(&display, 0)) {
        send_byte(0xff);
        for (;;) {}
    }
    send_byte(0x4f); send_byte(0x4c);
    for (index = 0; index < sizeof(framebuffer); index++) send_byte(framebuffer[index]);
    for (;;) {}
}
