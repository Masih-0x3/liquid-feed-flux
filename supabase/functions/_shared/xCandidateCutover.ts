/** Selects the strict lower bound for automatic X candidate reads. */
export function effectiveXCandidateCutoff(
  floors: Array<string | null | undefined>,
): string | null {
  const valid = floors.filter((floor): floor is string =>
    typeof floor === "string" && Number.isFinite(new Date(floor).getTime())
  );
  if (valid.length === 0) return null;
  return valid.reduce((latest, floor) =>
    new Date(floor).getTime() > new Date(latest).getTime() ? floor : latest
  );
}
