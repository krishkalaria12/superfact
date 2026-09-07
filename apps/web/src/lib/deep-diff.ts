/**
 * Paths at which two values differ, as dotted strings.
 *
 * Object key order is ignored: Postgres stores JSONB with its own key ordering, so a comparison
 * that went through `JSON.stringify` would report a difference every time qualifiers came back.
 */
export function deepDiff(expected: unknown, actual: unknown, path = ""): string[] {
  if (Object.is(expected, actual)) return [];

  if (
    expected === null ||
    actual === null ||
    typeof expected !== "object" ||
    typeof actual !== "object"
  ) {
    return [path || "."];
  }

  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) return [path || "."];
    if (expected.length !== actual.length) return [`${path}.length`];
    return expected.flatMap((item, i) => deepDiff(item, actual[i], `${path}[${i}]`));
  }

  const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
  return [...keys].flatMap((key) =>
    deepDiff(
      (expected as Record<string, unknown>)[key],
      (actual as Record<string, unknown>)[key],
      path ? `${path}.${key}` : key,
    ),
  );
}
