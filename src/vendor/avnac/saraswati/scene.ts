import type { SaraswatiColor } from "./types";
import {
  SARASWATI_SCENE_VERSION,
  type SaraswatiGroupNode,
  type SaraswatiNode,
  type SaraswatiNodeId,
  type SaraswatiRenderableNode,
  type SaraswatiScene,
  type SaraswatiSceneValidationIssue,
} from "./types";

export const SARASWATI_ROOT_ID = "root" as const;

export function createSaraswatiRootGroup(
  id: SaraswatiNodeId = SARASWATI_ROOT_ID,
): SaraswatiGroupNode {
  return {
    id,
    type: "group",
    parentId: null,
    rotation: 0,
    visible: true,
    opacity: 1,
    children: [],
  };
}

export function createEmptySaraswatiScene(input?: {
  width?: number;
  height?: number;
  bg?: SaraswatiColor;
}): SaraswatiScene {
  const root = createSaraswatiRootGroup();
  return {
    version: SARASWATI_SCENE_VERSION,
    root: root.id,
    nodes: { [root.id]: root },
    artboard: {
      width: input?.width ?? 4000,
      height: input?.height ?? 4000,
      bg: input?.bg ?? { type: "solid", color: "#ffffff" },
    },
  };
}

export function createSaraswatiScene(
  input: Omit<SaraswatiScene, "version">,
): SaraswatiScene {
  return {
    version: SARASWATI_SCENE_VERSION,
    ...input,
  };
}

export function cloneSaraswatiScene(scene: SaraswatiScene): SaraswatiScene {
  const nodes: Record<SaraswatiNodeId, SaraswatiNode> = {};
  for (const [id, node] of Object.entries(scene.nodes)) {
    if (node.type === "group") {
      nodes[id] = { ...node, children: [...node.children] };
      continue;
    }
    if (node.type === "polygon") {
      nodes[id] = {
        ...node,
        clipPath: node.clipPath ? { ...node.clipPath } : null,
        clipPathStack: node.clipPathStack?.map((clipPath) => ({ ...clipPath })),
        points: node.points.map((point) => ({ ...point })),
      };
      continue;
    }
    if (
      node.type === "rect" ||
      node.type === "ellipse" ||
      node.type === "text" ||
      node.type === "image"
    ) {
      nodes[id] = {
        ...node,
        clipPath: node.clipPath ? { ...node.clipPath } : null,
        clipPathStack: node.clipPathStack?.map((clipPath) => ({ ...clipPath })),
      };
      continue;
    }
    nodes[id] = { ...node };
  }
  return {
    version: scene.version,
    root: scene.root,
    nodes,
    artboard: {
      width: scene.artboard.width,
      height: scene.artboard.height,
      bg: cloneBgValue(scene.artboard.bg),
    },
  };
}

export function parseSaraswatiScene(raw: unknown): SaraswatiScene | null {
  if (!raw || typeof raw !== "object") return null;
  const scene = raw as Partial<SaraswatiScene>;
  if (scene.version !== SARASWATI_SCENE_VERSION) return null;
  if (!scene.root || typeof scene.root !== "string") return null;
  if (!scene.nodes || typeof scene.nodes !== "object") return null;
  if (
    !scene.artboard ||
    typeof scene.artboard.width !== "number" ||
    typeof scene.artboard.height !== "number" ||
    !scene.artboard.bg ||
    typeof scene.artboard.bg !== "object"
  ) {
    return null;
  }
  const typed = scene as SaraswatiScene;
  return validateSaraswatiScene(typed).length === 0 ? typed : null;
}

export function validateSaraswatiScene(
  scene: SaraswatiScene,
): SaraswatiSceneValidationIssue[] {
  const issues: SaraswatiSceneValidationIssue[] = [];
  const root = scene.nodes[scene.root];
  if (!root) {
    issues.push({ reason: "missing-root", nodeId: scene.root });
    return issues;
  }
  if (root.type !== "group") {
    issues.push({ reason: "root-must-be-group", nodeId: scene.root });
  }
  for (const node of Object.values(scene.nodes)) {
    if (node.type === "group") {
      for (const childId of node.children) {
        const child = scene.nodes[childId];
        if (!child) {
          issues.push({ reason: "missing-child", nodeId: childId });
          continue;
        }
        if (child.parentId !== node.id) {
          issues.push({ reason: "child-parent-mismatch", nodeId: childId });
        }
      }
      continue;
    }
    if (node.parentId && !scene.nodes[node.parentId]) {
      issues.push({ reason: "missing-parent", nodeId: node.id });
    }
  }
  return issues;
}

export function getSaraswatiNode(
  scene: SaraswatiScene,
  nodeId: SaraswatiNodeId,
): SaraswatiNode | null {
  return scene.nodes[nodeId] ?? null;
}

export function isSaraswatiRenderableNode(
  node: SaraswatiNode,
): node is SaraswatiRenderableNode {
  return (
    node.type === "rect" ||
    node.type === "ellipse" ||
    node.type === "polygon" ||
    node.type === "line" ||
    node.type === "text" ||
    node.type === "image"
  );
}

export function listSaraswatiNodesInRenderOrder(
  scene: SaraswatiScene,
): SaraswatiRenderableNode[] {
  const ordered: SaraswatiRenderableNode[] = [];
  visitNode(scene, scene.root, 1, ordered);
  return ordered;
}

function visitNode(
  scene: SaraswatiScene,
  nodeId: SaraswatiNodeId,
  inheritedOpacity: number,
  ordered: SaraswatiRenderableNode[],
) {
  const node = scene.nodes[nodeId];
  if (!node || node.visible === false) return;
  if (node.type === "group") {
    const groupOpacity =
      inheritedOpacity * Math.max(0, Math.min(1, node.opacity));
    for (const childId of node.children) {
      visitNode(scene, childId, groupOpacity, ordered);
    }
    return;
  }
  // Compose inherited group opacity into the node
  if (inheritedOpacity !== 1) {
    ordered.push({ ...node, opacity: node.opacity * inheritedOpacity });
  } else {
    ordered.push(node);
  }
}

function cloneBgValue(bg: SaraswatiColor): SaraswatiColor {
  if (bg.type === "solid") return { ...bg };
  return {
    type: "gradient",
    angle: bg.angle,
    css: bg.css,
    stops: bg.stops.map((stop) => ({ ...stop })),
  };
}

export * from "./types";
