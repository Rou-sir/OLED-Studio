#include <string.h>
#include "renderer.h"
#include "polygon.h"

#define MAX_SIDE 512
static u8g2_t ctx;
static u8x8_display_info_t display;
static uint8_t tiles[MAX_SIDE * MAX_SIDE / 8];
static uint8_t pixels[MAX_SIDE * MAX_SIDE];
static int screen_width, screen_height;

int render_init(int width, int height, int page_tiles)
{
    if (width < 1 || height < 1 || width > MAX_SIDE || height > MAX_SIDE ||
        page_tiles < 0 || page_tiles > (height + 7) / 8) return 0;
    memset(&ctx, 0, sizeof(ctx));
    memset(&display, 0, sizeof(display));
    memset(tiles, 0, sizeof(tiles));
    memset(pixels, 0, sizeof(pixels));
    screen_width = width;
    screen_height = height;
    display.tile_width = (uint8_t)((width + 7) / 8);
    display.tile_height = (uint8_t)((height + 7) / 8);
    display.pixel_width = (uint16_t)width;
    display.pixel_height = (uint16_t)height;
    ctx.u8x8.display_info = &display;
    u8g2_SetupBuffer(&ctx, tiles,
        (uint8_t)(page_tiles ? page_tiles : display.tile_height),
        u8g2_ll_hvline_vertical_top_lsb, U8G2_R0);
    u8g2_SetFontDirection(&ctx, 0);
    render_font(0, NULL);
    return 1;
}

u8g2_t *render_context(void) { return &ctx; }
void render_page(int tile_row)
{
    u8g2_SetBufferCurrTileRow(&ctx, (uint8_t)tile_row);
    u8g2_ClearBuffer(&ctx);
}
void render_color(int color) { u8g2_SetDrawColor(&ctx, (uint8_t)color); }
void render_line(int x0, int y0, int x1, int y1)
{
    u8g2_DrawLine(&ctx, (u8g2_uint_t)x0, (u8g2_uint_t)y0, (u8g2_uint_t)x1, (u8g2_uint_t)y1);
}
void render_pixel(int x, int y) { u8g2_DrawPixel(&ctx, (u8g2_uint_t)x, (u8g2_uint_t)y); }
void render_hvline(int x, int y, int length, int vertical)
{
    if (vertical) u8g2_DrawVLine(&ctx, x, y, length);
    else u8g2_DrawHLine(&ctx, x, y, length);
}
void render_ellipse(int x, int y, int rx, int ry, int fill)
{
    if (fill) u8g2_DrawFilledEllipse(&ctx, x, y, rx, ry, U8G2_DRAW_ALL);
    else u8g2_DrawEllipse(&ctx, x, y, rx, ry, U8G2_DRAW_ALL);
}
void render_arc(int x, int y, int radius, int start, int end)
{
    u8g2_DrawArc(&ctx, x, y, radius, (uint8_t)start, (uint8_t)end);
}
void render_rect(int x, int y, int w, int h, int fill)
{
    if (fill) u8g2_DrawBox(&ctx, (u8g2_uint_t)x, (u8g2_uint_t)y, (u8g2_uint_t)w, (u8g2_uint_t)h);
    else u8g2_DrawFrame(&ctx, (u8g2_uint_t)x, (u8g2_uint_t)y, (u8g2_uint_t)w, (u8g2_uint_t)h);
}
void render_circle(int x, int y, int r, int fill)
{
    if (fill) u8g2_DrawDisc(&ctx, (u8g2_uint_t)x, (u8g2_uint_t)y, (u8g2_uint_t)r, U8G2_DRAW_ALL);
    else u8g2_DrawCircle(&ctx, (u8g2_uint_t)x, (u8g2_uint_t)y, (u8g2_uint_t)r, U8G2_DRAW_ALL);
}
void render_round_rect(int x, int y, int w, int h, int r, int fill)
{
    if (fill) u8g2_DrawRBox(&ctx, (u8g2_uint_t)x, (u8g2_uint_t)y, (u8g2_uint_t)w, (u8g2_uint_t)h, (u8g2_uint_t)r);
    else u8g2_DrawRFrame(&ctx, (u8g2_uint_t)x, (u8g2_uint_t)y, (u8g2_uint_t)w, (u8g2_uint_t)h, (u8g2_uint_t)r);
}
void render_triangle(int x0, int y0, int x1, int y1, int x2, int y2, int fill)
{
    if (fill) u8g2_DrawTriangle(&ctx, (int16_t)x0, (int16_t)y0, (int16_t)x1, (int16_t)y1, (int16_t)x2, (int16_t)y2);
    else {
        render_line(x0, y0, x1, y1);
        render_line(x1, y1, x2, y2);
        render_line(x2, y2, x0, y0);
    }
}
int render_polygon(const int16_t *xy, int count, int fill)
{
    return oled_polygon(&ctx, xy, count, fill);
}
void render_bitmap(int x, int y, int w, int h, const uint8_t *data, int transparent)
{
    u8g2_SetBitmapMode(&ctx, (uint8_t)transparent);
    u8g2_DrawXBM(&ctx, (u8g2_uint_t)x, (u8g2_uint_t)y, (u8g2_uint_t)w, (u8g2_uint_t)h, data);
}
void render_font(int builtin, const uint8_t *data)
{
    const uint8_t *fonts[] = {u8g2_font_5x7_tr, u8g2_font_6x10_tr, u8g2_font_9x15_tr};
    u8g2_SetFont(&ctx, data ? data : fonts[builtin >= 0 && builtin < 3 ? builtin : 0]);
    u8g2_SetFontRefHeightAll(&ctx);
    u8g2_SetFontPosBaseline(&ctx);
}
int render_text(int x, int baseline, const char *text, int transparent)
{
    u8g2_SetFontMode(&ctx, (uint8_t)transparent);
    return u8g2_DrawUTF8(&ctx, (u8g2_uint_t)x, (u8g2_uint_t)baseline, text);
}
int render_ascent(void) { return u8g2_GetAscent(&ctx); }
int render_descent(void) { return u8g2_GetDescent(&ctx); }
int render_width(const char *text) { return u8g2_GetUTF8Width(&ctx, text); }
int render_glyph(int code) { return u8g2_IsGlyph(&ctx, (uint16_t)code); }

uint8_t *render_pixels(void)
{
    int y, x;
    int first_y = ctx.tile_curr_row * 8;
    int last_y = first_y + ctx.tile_buf_height * 8;
    if (last_y > screen_height) last_y = screen_height;
    for (y = first_y; y < last_y; ++y)
        for (x = 0; x < screen_width; ++x)
            pixels[y * screen_width + x] =
                (tiles[((y - first_y) / 8) * display.tile_width * 8 + x] >> (y % 8)) & 1;
    return pixels;
}
