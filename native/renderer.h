#ifndef OLED_RENDERER_H
#define OLED_RENDERER_H
#include <stdint.h>
#include "u8g2.h"

#ifdef __cplusplus
extern "C" {
#endif
int render_init(int width, int height, int page_tiles);
void render_page(int tile_row);
void render_color(int color);
void render_line(int x0, int y0, int x1, int y1);
void render_pixel(int x, int y);
void render_hvline(int x, int y, int length, int vertical);
void render_ellipse(int x, int y, int rx, int ry, int fill);
void render_arc(int x, int y, int radius, int start, int end);
void render_rect(int x, int y, int w, int h, int fill);
void render_round_rect(int x, int y, int w, int h, int r, int fill);
void render_circle(int x, int y, int r, int fill);
void render_triangle(int x0, int y0, int x1, int y1, int x2, int y2, int fill);
int render_polygon(const int16_t *xy, int count, int fill);
void render_bitmap(int x, int y, int w, int h, const uint8_t *data, int transparent);
void render_font(int builtin, const uint8_t *data);
int render_text(int x, int baseline, const char *text, int transparent);
int render_ascent(void);
int render_descent(void);
int render_width(const char *text);
int render_glyph(int code);
uint8_t *render_pixels(void);
u8g2_t *render_context(void);
#ifdef __cplusplus
}
#endif
#endif
