#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "renderer.h"

void fixture(void)
{
    static const uint8_t image[] = {0x55, 0x15, 0xaa, 0x0a, 0xff, 0x1f};
    static const int16_t polygon[] = {70, 29, 90, 29, 90, 40, 80, 35, 70, 40};
    render_color(1);
    render_line(0, 0, 127, 63);
    render_rect(2, 2, 10, 6, 0);
    render_rect(14, 2, 10, 6, 1);
    render_circle(35, 10, 8, 0);
    render_circle(55, 10, 8, 1);
    render_triangle(70, 2, 85, 2, 78, 20, 1);
    render_triangle(90, 2, 105, 2, 98, 20, 0);
    render_polygon(polygon, 5, 1);
    render_bitmap(108, 2, 13, 3, image, 1);
    render_bitmap(108, 10, 13, 3, image, 0);
    render_font(0, NULL); render_text(0, 30, "ASCII 5x7", 1);
    render_font(1, NULL); render_text(0, 44, "gyp 6x10", 0);
    render_font(2, NULL); render_text(0, 61, "ABC 9x15", 1);
    render_color(0); render_rect(3, 3, 3, 2, 1);
}

int main(int argc, char **argv)
{
    FILE *output, *input;
    static uint8_t font[65536];
    static char text[16384];
    size_t font_size, text_size;
    int row, paged = argc > 2 ? atoi(argv[2]) : 0;
    int custom_font = argc == 5;
    if ((argc != 2 && argc != 3 && argc != 5) || (paged != 0 && paged != 1) || !render_init(128, 64, paged)) {
        fprintf(stderr, "Usage: reference output.raw [0|1] [font.bin text.txt]\n"); return 2;
    }
    if (custom_font) {
        input = fopen(argv[3], "rb");
        if (!input) { perror("font input"); return 1; }
        font_size = fread(font, 1, sizeof(font), input);
        fclose(input);
        if (font_size < 25 || font_size == sizeof(font)) { fprintf(stderr, "font size invalid\n"); return 1; }
        input = fopen(argv[4], "rb");
        if (!input) { perror("text input"); return 1; }
        text_size = fread(text, 1, sizeof(text) - 1, input);
        fclose(input);
        text[text_size] = 0;
        render_font(0, font);
        printf("Font ascent=%d descent=%d\n", render_ascent(), render_descent());
    }
    for (row = 0; row < (paged ? 8 : 1); ++row) {
        render_page(row);
        if (custom_font) {
            char *line = text, *end;
            int baseline;
            render_font(0, font);
            baseline = render_ascent() + 2;
            render_color(1);
            do {
                end = strchr(line, '\n');
                if (end) *end = 0;
                render_text(2, baseline, line, 1);
                if (end) *end = '\n';
                baseline += render_ascent() - render_descent() + 2;
                line = end ? end + 1 : NULL;
            } while (line);
        } else fixture();
        render_pixels();
    }
    output = fopen(argv[1], "wb");
    if (!output) { perror("reference output"); return 1; }
    if (fwrite(render_pixels(), 1, 128 * 64, output) != 128 * 64) {
        perror("reference write"); fclose(output); return 1;
    }
    return fclose(output) != 0;
}
