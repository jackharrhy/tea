export interface LoaderArgs {
  request: Request;
}

export interface ActionArgs extends LoaderArgs {}

export interface LoaderArgsWithParams<
  Params extends Record<string, string> = Record<string, string>,
> extends LoaderArgs {
  params: Params;
}
