export function writeBatches<T>(values: T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new Error("Batch size must be a positive integer.");
  const batches: T[][] = [];
  for (let offset = 0; offset < values.length; offset += size)
    batches.push(values.slice(offset, offset + size));
  return batches;
}
