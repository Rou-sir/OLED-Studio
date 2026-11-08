#include <stdio.h>
#include <stdlib.h>
#include "renderer.h"
#include "oled_ui.h"

int main(int argc, char **argv)
{
    FILE *output;
    int row, paged, width, height, page;
    if (argc != 4) return 2;
    page = atoi(argv[2]); paged = atoi(argv[3]);
    width = OLED_UI_WIDTH; height = OLED_UI_HEIGHT;
    if (!render_init(width, height, paged ? 1 : 0)) return 3;
    for (row = 0; row < (paged ? (height + 7) / 8 : 1); ++row) {
        if (paged) render_page(row);
        if (!oled_ui_draw(render_context(), (OledUiPage)page)) return 7;
        render_pixels();
    }
    output = fopen(argv[1], "wb");
    if (!output) return 4;
    if (fwrite(render_pixels(), 1, width * height, output) != (size_t)(width * height)) {
        fclose(output); return 5;
    }
    return fclose(output) == 0 ? 0 : 6;
}
