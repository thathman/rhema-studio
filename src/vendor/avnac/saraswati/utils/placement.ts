export type PlacementRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function getPlacementCenter(rect: PlacementRect): {
  x: number;
  y: number;
} {
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
  };
}

export function placementCenterOccupied(
  candidate: PlacementRect,
  existing: readonly PlacementRect[],
  tolerance = 2,
): boolean {
  const target = getPlacementCenter(candidate);
  return existing.some((rect) => {
    const center = getPlacementCenter(rect);
    return (
      Math.abs(center.x - target.x) < tolerance &&
      Math.abs(center.y - target.y) < tolerance
    );
  });
}

export function placementBoundsOccupied(
  candidate: PlacementRect,
  existing: readonly PlacementRect[],
  tolerance = 2,
): boolean {
  return existing.some((rect) => {
    if (candidate.x + candidate.width <= rect.x + tolerance) return false;
    if (rect.x + rect.width <= candidate.x + tolerance) return false;
    if (candidate.y + candidate.height <= rect.y + tolerance) return false;
    if (rect.y + rect.height <= candidate.y + tolerance) return false;
    return true;
  });
}

function clampPlacementToArtboard(
  rect: PlacementRect,
  artboardW: number,
  artboardH: number,
): PlacementRect {
  const maxX = Math.max(0, artboardW - rect.width);
  const maxY = Math.max(0, artboardH - rect.height);
  return {
    ...rect,
    x: Math.min(maxX, Math.max(0, rect.x)),
    y: Math.min(maxY, Math.max(0, rect.y)),
  };
}

export function stepPlacementDiagonally(
  candidate: PlacementRect,
  existing: readonly PlacementRect[],
  artboardW: number,
  artboardH: number,
  step: number,
  isOccupied: (
    candidateRect: PlacementRect,
    existingRects: readonly PlacementRect[],
  ) => boolean,
): PlacementRect {
  let positioned = clampPlacementToArtboard(candidate, artboardW, artboardH);
  const maxX = Math.max(0, artboardW - positioned.width);
  const maxY = Math.max(0, artboardH - positioned.height);

  while (
    isOccupied(positioned, existing) &&
    (positioned.x < maxX || positioned.y < maxY)
  ) {
    positioned = {
      ...positioned,
      x: Math.min(maxX, positioned.x + step),
      y: Math.min(maxY, positioned.y + step),
    };
  }

  return positioned;
}
