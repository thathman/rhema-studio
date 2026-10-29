type AvnacShapeKind = "rect" | "ellipse" | "polygon" | "star" | "line" | "arrow";

export function avnacShapeKindLayerLabel(kind: AvnacShapeKind): string {
  const labels: Record<AvnacShapeKind, string> = {
    rect: "Square",
    ellipse: "Ellipse",
    polygon: "Polygon",
    star: "Star",
    line: "Line",
    arrow: "Arrow",
  };
  return labels[kind];
}
