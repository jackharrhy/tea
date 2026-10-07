export class MapParseError extends Error {
  public constructor(
    message: string,
    public readonly line: number,
    public readonly column: number,
  ) {
    super(`${message} at ${line}:${column}`);
    this.name = "MapParseError";
  }
}
