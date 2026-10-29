import type {
  SaraswatiRenderCommand,
  SaraswatiRenderImageCommand,
} from "../../../saraswati/render/commands";
import type { RendererBackend } from "../../types";
import {
  renderCanvas2DEllipseCommand,
  renderCanvas2DLineCommand,
  renderCanvas2DPolygonCommand,
  renderCanvas2DRectCommand,
} from "./shapes";
import {
  applyCanvas2DClipPaths,
  loadCanvas2DImage,
  roundedCanvas2DRectPath,
  withCanvas2DTransform,
} from "./shared";
import { renderCanvas2DTextCommand } from "./text";

export type Canvas2DRendererTarget = CanvasRenderingContext2D;

export const canvas2DRendererBackend: RendererBackend<Canvas2DRendererTarget> =
  {
    kind: "canvas2d",
    render: renderCanvas2DCommands,
  };

export async function renderCanvas2DCommands(
  ctx: Canvas2DRendererTarget,
  commands: readonly SaraswatiRenderCommand[],
): Promise<void> {
  for (const command of commands) {
    switch (command.type) {
      case "rect":
        renderCanvas2DRectCommand(ctx, command);
        break;
      case "ellipse":
        renderCanvas2DEllipseCommand(ctx, command);
        break;
      case "polygon":
        renderCanvas2DPolygonCommand(ctx, command);
        break;
      case "line":
        renderCanvas2DLineCommand(ctx, command);
        break;
      case "text":
        renderCanvas2DTextCommand(ctx, command);
        break;
      case "image":
        try {
          await renderCanvas2DImageCommand(ctx, command);
        } catch {
          // Image failed to load — skip this shape, continue rendering others
        }
        break;
    }
  }
}

async function renderCanvas2DImageCommand(
  ctx: CanvasRenderingContext2D,
  command: SaraswatiRenderImageCommand,
) {
  const image = await loadCanvas2DImage(command.src);
  const sourceSize = readCanvasImageSourceSize(image);
  withCanvas2DTransform(ctx, command, command.width, command.height, () => {
    applyCanvas2DClipPaths(ctx, command.clipPathStack, command.clipPath);
    const targetX = -command.width / 2;
    const targetY = -command.height / 2;
    const radius = Math.max(
      0,
      Math.min(command.borderRadius, command.width / 2, command.height / 2),
    );
    if (radius > 0) {
      ctx.beginPath();
      roundedCanvas2DRectPath(
        ctx,
        targetX,
        targetY,
        command.width,
        command.height,
        radius,
      );
      ctx.clip();
    }
    const cropX = Math.max(0, Math.round(command.cropX));
    const cropY = Math.max(0, Math.round(command.cropY));
    const maxSourceWidth = Math.max(1, sourceSize.width - cropX);
    const maxSourceHeight = Math.max(1, sourceSize.height - cropY);
    const sourceWidth =
      command.cropWidth != null
        ? Math.max(1, Math.min(maxSourceWidth, Math.round(command.cropWidth)))
        : maxSourceWidth;
    const sourceHeight =
      command.cropHeight != null
        ? Math.max(1, Math.min(maxSourceHeight, Math.round(command.cropHeight)))
        : maxSourceHeight;
    ctx.drawImage(
      image,
      cropX,
      cropY,
      sourceWidth,
      sourceHeight,
      targetX,
      targetY,
      command.width,
      command.height,
    );
  });
}

function readCanvasImageSourceSize(image: CanvasImageSource): {
  width: number;
  height: number;
} {
  if (image instanceof ImageBitmap) {
    return { width: image.width, height: image.height };
  }
  if (image instanceof HTMLImageElement) {
    return {
      width: image.naturalWidth || image.width,
      height: image.naturalHeight || image.height,
    };
  }
  if (image instanceof HTMLCanvasElement) {
    return { width: image.width, height: image.height };
  }
  if (
    typeof OffscreenCanvas !== "undefined" &&
    image instanceof OffscreenCanvas
  ) {
    return { width: image.width, height: image.height };
  }
  if (image instanceof HTMLVideoElement) {
    return { width: image.videoWidth, height: image.videoHeight };
  }
  return { width: 1, height: 1 };
}
