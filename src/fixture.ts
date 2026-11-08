import { allocate, withText } from "./runtime";
import type { RendererModule } from "./runtime";

export function drawFixture(module: RendererModule): void {
  module._render_color(1);
  module._render_line(0, 0, 127, 63);
  module._render_rect(2, 2, 10, 6, 0);
  module._render_rect(14, 2, 10, 6, 1);
  module._render_circle(35, 10, 8, 0);
  module._render_circle(55, 10, 8, 1);
  module._render_triangle(70, 2, 85, 2, 78, 20, 1);
  module._render_triangle(90, 2, 105, 2, 98, 20, 0);
  const points = new Int16Array([70, 29, 90, 29, 90, 40, 80, 35, 70, 40]);
  const polygon = allocate(module, new Uint8Array(points.buffer));
  try { module._render_polygon(polygon, 5, 1); }
  finally { module._free(polygon); }
  const bitmap = allocate(module, new Uint8Array([0x55, 0x15, 0xaa, 0x0a, 0xff, 0x1f]));
  try {
    module._render_bitmap(108, 2, 13, 3, bitmap, 1);
    module._render_bitmap(108, 10, 13, 3, bitmap, 0);
  } finally { module._free(bitmap); }
  module._render_font(0, 0); withText(module, "ASCII 5x7", text => module._render_text(0, 30, text, 1));
  module._render_font(1, 0); withText(module, "gyp 6x10", text => module._render_text(0, 44, text, 0));
  module._render_font(2, 0); withText(module, "ABC 9x15", text => module._render_text(0, 61, text, 1));
  module._render_color(0); module._render_rect(3, 3, 3, 2, 1);
}
