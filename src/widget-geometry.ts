import type { Component } from "./project";

export type Widget = Extract<Component, { type: "progress" | "battery" | "sector" }>;
export type WidgetOperation =
  | { type: "color"; bit: 0 | 1 | 2 }
  | { type: "box" | "frame"; x: number; y: number; width: number; height: number }
  | { type: "line"; x: number; y: number; x1: number; y1: number }
  | { type: "triangle"; points: [number, number, number, number, number, number] }
  | { type: "disc"; x: number; y: number; radius: number };

// The same integer geometry drives the native preview and both exported APIs.
export function widgetOperations(component: Widget): WidgetOperation[] {
  const ops: WidgetOperation[] = [];
  if (component.type === "sector") {
    if (component.sweepAngle === 360) return [{ type: "disc", x: component.x, y: component.y, radius: component.radius }];
    const count = Math.ceil(component.sweepAngle / 3);
    const vertex = (index: number): [number, number] => {
      const angle = (component.startAngle + component.sweepAngle * index / count) * Math.PI / 180;
      return [component.x + Math.round(component.radius * Math.cos(angle)), component.y - Math.round(component.radius * Math.sin(angle))];
    };
    for (let index = 0; index < count; index++) {
      const a = vertex(index), b = vertex(index + 1);
      if (a[0] !== b[0] || a[1] !== b[1]) ops.push({ type: "triangle", points: [component.x, component.y, ...a, ...b] });
    }
    return ops;
  }
  const { x, y, width, height } = component;
  if (component.type === "progress") {
    const inset = component.border ? 1 : 0, w = width - 2 * inset, h = height - 2 * inset;
    if (component.border) ops.push({ type: "frame", x, y, width, height });
    const amount = Math.floor((component.value - component.min) * (component.vertical ? h : w) / (component.max - component.min));
    if (amount) ops.push({ type: "box", x: x + inset, y: y + inset + (component.vertical ? h - amount : 0),
      width: component.vertical ? w : amount, height: component.vertical ? amount : h });
    return ops;
  }
  const body = width - 2, level = Math.floor((body - 4) * component.value / 100);
  ops.push({ type: "frame", x, y, width: body, height },
    { type: "box", x: x + body, y: y + Math.floor(height / 3), width: 2, height: Math.max(1, Math.floor(height / 3)) });
  if (level) ops.push({ type: "box", x: x + 2, y: y + 2, width: level, height: height - 4 });
  if (component.charging) {
    const cx = x + Math.floor(body / 2), cy = y + Math.floor(height / 2);
    // XOR keeps the charging mark visible over both lit and unlit battery cells.
    ops.push({ type: "color", bit: 2 });
    ops.push({ type: "line", x: cx + 2, y: y + 1, x1: cx - 2, y1: cy },
      { type: "line", x: cx - 2, y: cy, x1: cx + 2, y1: cy },
      { type: "line", x: cx + 2, y: cy, x1: cx - 2, y1: y + height - 2 },
      { type: "color", bit: component.bit });
  }
  return ops;
}

export function arcAngles(start: number, sweep: number): [number, number] {
  const first = Math.floor(start * 256 / 360);
  return [first, sweep === 360 ? first : (first + Math.max(1, Math.floor(sweep * 256 / 360))) % 256];
}
