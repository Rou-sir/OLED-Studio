#ifndef OLED_POLYGON_H
#define OLED_POLYGON_H
#include <stdint.h>
#ifdef OLED_POLYGON_CPP
#include <U8g2lib.h>
#define OLED_POLYGON_CONTEXT U8G2
#define OLED_POLYGON_LINE(ctx, x, y, x1, y1) (ctx)->drawLine(x, y, x1, y1)
#define OLED_POLYGON_PIXEL(ctx, x, y) (ctx)->drawPixel(x, y)
#define OLED_POLYGON_WIDTH(ctx) (ctx)->getDisplayWidth()
#define OLED_POLYGON_HEIGHT(ctx) (ctx)->getDisplayHeight()
#else
#include "u8g2.h"
#define OLED_POLYGON_CONTEXT u8g2_t
#define OLED_POLYGON_LINE(ctx, x, y, x1, y1) u8g2_DrawLine(ctx, x, y, x1, y1)
#define OLED_POLYGON_PIXEL(ctx, x, y) u8g2_DrawPixel(ctx, x, y)
#define OLED_POLYGON_WIDTH(ctx) u8g2_GetDisplayWidth(ctx)
#define OLED_POLYGON_HEIGHT(ctx) u8g2_GetDisplayHeight(ctx)
#endif

/* Coordinates are validated by the project layer before this drawing helper. */
static inline int oled_polygon(OLED_POLYGON_CONTEXT *ctx, const int16_t *xy, int count, int fill)
{
    int x, y, i, j, inside;
    int min_x = 32767, min_y = 32767, max_x = -32768, max_y = -32768;
    if (!ctx || !xy || count < 3 || count > 256) return 0;
    for (i = 0; i < count; ++i) {
        x = xy[2 * i]; y = xy[2 * i + 1];
        if (x < min_x) min_x = x;
        if (y < min_y) min_y = y;
        if (x > max_x) max_x = x;
        if (y > max_y) max_y = y;
        if (!fill) {
            j = (i + 1) % count;
            OLED_POLYGON_LINE(ctx, (u8g2_uint_t)x, (u8g2_uint_t)y,
                (u8g2_uint_t)xy[2 * j], (u8g2_uint_t)xy[2 * j + 1]);
        }
    }
    if (!fill) return 1;
    if (min_x < 0) min_x = 0;
    if (min_y < 0) min_y = 0;
    if (max_x > (int)OLED_POLYGON_WIDTH(ctx)) max_x = OLED_POLYGON_WIDTH(ctx);
    if (max_y > (int)OLED_POLYGON_HEIGHT(ctx)) max_y = OLED_POLYGON_HEIGHT(ctx);
    /* Even-odd coverage at pixel centers: half-open edges, independent of winding. */
    for (y = min_y; y < max_y; ++y) {
        for (x = min_x; x < max_x; ++x) {
            inside = 0;
            for (i = 0, j = count - 1; i < count; j = i++) {
                int32_t xi = xy[2 * i], yi = xy[2 * i + 1];
                int32_t xj = xy[2 * j], yj = xy[2 * j + 1];
                int32_t py = 2 * y + 1, px = 2 * x + 1;
                if ((2 * yi > py) != (2 * yj > py)) {
                    int64_t lhs = (int64_t)(px - 2 * xi) * (yj - yi);
                    int64_t rhs = (int64_t)(xj - xi) * (py - 2 * yi);
                    if ((yj > yi && lhs < rhs) || (yj < yi && lhs > rhs)) inside = !inside;
                }
            }
            if (inside) OLED_POLYGON_PIXEL(ctx, (u8g2_uint_t)x, (u8g2_uint_t)y);
        }
        #undef OLED_POLYGON_CONTEXT
        #undef OLED_POLYGON_LINE
        #undef OLED_POLYGON_PIXEL
        #undef OLED_POLYGON_WIDTH
        #undef OLED_POLYGON_HEIGHT
    }
    return 1;
}
#endif
