import type {
  SaraswatiRenderEllipseCommand,
  SaraswatiRenderLineCommand,
  SaraswatiRenderPolygonCommand,
  SaraswatiRenderRectCommand,
} from "../../../saraswati/render/commands";
import {
  applyCanvas2DEffects,
  applyCanvas2DClipPaths,
  centeredCanvas2DBox,
  fillAndStrokeCanvas2DPath,
  paintCanvas2DStyle,
  roundedCanvas2DRectPath,
  withCanvas2DTransform,
} from "./shared";

export function renderCanvas2DRectCommand(
  ctx: CanvasRenderingContext2D,
  command: SaraswatiRenderRectCommand,
) {
  withCanvas2DTransform(ctx, command, command.width, command.height, () => {
    applyCanvas2DClipPaths(ctx, command.clipPathStack, command.clipPath);
    const box = centeredCanvas2DBox(command.width, command.height);
    ctx.beginPath();
    roundedCanvas2DRectPath(
      ctx,
      box.x,
      box.y,
      box.width,
      box.height,
      Math.max(command.radiusX, command.radiusY),
    );
    fillAndStrokeCanvas2DPath(
      ctx,
      command.fill,
      command.stroke,
      command.strokeWidth,
      box,
    );
  });
}

export function renderCanvas2DEllipseCommand(
  ctx: CanvasRenderingContext2D,
  command: SaraswatiRenderEllipseCommand,
) {
  withCanvas2DTransform(ctx, command, command.width, command.height, () => {
    applyCanvas2DClipPaths(ctx, command.clipPathStack, command.clipPath);
    const box = centeredCanvas2DBox(command.width, command.height);
    ctx.beginPath();
    ctx.ellipse(0, 0, command.width / 2, command.height / 2, 0, 0, Math.PI * 2);
    fillAndStrokeCanvas2DPath(
      ctx,
      command.fill,
      command.stroke,
      command.strokeWidth,
      box,
    );
  });
}

export function renderCanvas2DPolygonCommand(
  ctx: CanvasRenderingContext2D,
  command: SaraswatiRenderPolygonCommand,
) {
  if (command.points.length < 2) return;
  withCanvas2DTransform(ctx, command, command.width, command.height, () => {
    applyCanvas2DClipPaths(ctx, command.clipPathStack, command.clipPath);
    const box = centeredCanvas2DBox(command.width, command.height);
    ctx.beginPath();
    ctx.moveTo(command.points[0]!.x, command.points[0]!.y);
    for (let index = 1; index < command.points.length; index += 1) {
      const point = command.points[index]!;
      ctx.lineTo(point.x, point.y);
    }
    ctx.closePath();
    fillAndStrokeCanvas2DPath(
      ctx,
      command.fill,
      command.stroke,
      command.strokeWidth,
      box,
    );
  });
}

const ARROWHEAD_ANGLE = Math.PI / 7;

function arrowheadLengthForStroke(strokeWidth: number) {
  const raw = Math.max(1, strokeWidth) * 2.25;
  return Math.max(5, Math.min(72, raw));
}

export function renderCanvas2DLineCommand(
  ctx: CanvasRenderingContext2D,
  command: SaraswatiRenderLineCommand,
) {
  const { x1, y1, x2, y2 } = command;
  const bx = Math.min(x1, x2);
  const by = Math.min(y1, y2);
  const strokeBox = {
    x: bx,
    y: by,
    width: Math.max(1, Math.abs(x2 - x1)),
    height: Math.max(1, Math.abs(y2 - y1)),
  };
  const strokeStyle = paintCanvas2DStyle(ctx, command.stroke, strokeBox);
  if (!strokeStyle || command.strokeWidth <= 0) return;

  // Compute quadratic control point for curved paths
  let cpX = (x1 + x2) / 2;
  let cpY = (y1 + y2) / 2;
  const isCurved = command.pathType === "curved" && command.curveBulge !== 0;
  if (isCurved) {
    const L = Math.hypot(x2 - x1, y2 - y1);
    if (L > 0) {
      const dx = x2 - x1;
      const dy = y2 - y1;
      const perpX = -dy / L;
      const perpY = dx / L;
      cpX = x1 + command.curveT * dx + command.curveBulge * perpX;
      cpY = y1 + command.curveT * dy + command.curveBulge * perpY;
    }
  }

  ctx.save();
  ctx.globalAlpha *= Math.max(0, Math.min(1, command.opacity));
  applyCanvas2DEffects(ctx, command);
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = command.strokeWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Scene editor line tools currently enforce solid strokes only.
  ctx.setLineDash([]);

  // Shorten shaft endpoints so the stroke doesn't poke through the arrowhead fill
  const arrowLength = arrowheadLengthForStroke(command.strokeWidth);
  const shaftInset = arrowLength * 0.65;
  const lineAngle = Math.atan2(y2 - y1, x2 - x1);
  let drawX1 = x1,
    drawY1 = y1,
    drawX2 = x2,
    drawY2 = y2;
  if (command.arrowEnd) {
    const tipAngle = isCurved ? Math.atan2(y2 - cpY, x2 - cpX) : lineAngle;
    drawX2 = x2 - shaftInset * Math.cos(tipAngle);
    drawY2 = y2 - shaftInset * Math.sin(tipAngle);
  }
  if (command.arrowStart) {
    const tailAngle = isCurved
      ? Math.atan2(y1 - cpY, x1 - cpX)
      : lineAngle + Math.PI;
    drawX1 = x1 - shaftInset * Math.cos(tailAngle);
    drawY1 = y1 - shaftInset * Math.sin(tailAngle);
  }

  ctx.beginPath();
  ctx.moveTo(drawX1, drawY1);
  if (isCurved) {
    ctx.quadraticCurveTo(cpX, cpY, drawX2, drawY2);
  } else {
    ctx.lineTo(drawX2, drawY2);
  }
  ctx.stroke();

  // Arrowheads — use tangent direction at the tip, not the chord
  if (command.arrowEnd) {
    const fromX = isCurved ? cpX : x1;
    const fromY = isCurved ? cpY : y1;
    drawArrowhead(ctx, x2, y2, fromX, fromY, command.strokeWidth, strokeStyle);
  }
  if (command.arrowStart) {
    const fromX = isCurved ? cpX : x2;
    const fromY = isCurved ? cpY : y2;
    drawArrowhead(ctx, x1, y1, fromX, fromY, command.strokeWidth, strokeStyle);
  }

  ctx.restore();
}

function drawArrowhead(
  ctx: CanvasRenderingContext2D,
  tipX: number,
  tipY: number,
  fromX: number,
  fromY: number,
  strokeWidth: number,
  strokeStyle: string | CanvasGradient,
) {
  const angle = Math.atan2(tipY - fromY, tipX - fromX);
  const length = arrowheadLengthForStroke(strokeWidth);
  ctx.save();
  ctx.fillStyle = strokeStyle;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(
    tipX - length * Math.cos(angle - ARROWHEAD_ANGLE),
    tipY - length * Math.sin(angle - ARROWHEAD_ANGLE),
  );
  ctx.lineTo(
    tipX - length * Math.cos(angle + ARROWHEAD_ANGLE),
    tipY - length * Math.sin(angle + ARROWHEAD_ANGLE),
  );
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
