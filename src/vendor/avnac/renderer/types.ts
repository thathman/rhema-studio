import type { SaraswatiRenderCommand } from "../saraswati/render/commands";

export type RendererKind = "canvas2d" | "pixi";

export type RendererBackend<TTarget> = {
  kind: RendererKind;
  render: (
    target: TTarget,
    commands: readonly SaraswatiRenderCommand[],
  ) => Promise<void> | void;
};