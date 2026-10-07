export function mapTriple<Input, Output>(
  values: readonly Input[],
  transform: (value: Input, index: 0 | 1 | 2) => Output,
): readonly [Output, Output, Output] {
  if (values.length !== 3)
    throw new Error(`Expected three values, received ${values.length}`);
  return [
    transform(values[0]!, 0),
    transform(values[1]!, 1),
    transform(values[2]!, 2),
  ];
}
