export class OperationError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function operationErrorResponse(error: unknown): Response {
  if (error instanceof OperationError) {
    return Response.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status },
    );
  }
  if (error instanceof ZodError) {
    return Response.json(
      {
        error: {
          code: "invalid_request",
          message: "Operation input is invalid",
        },
      },
      { status: 400 },
    );
  }
  throw error;
}

export async function readOperationJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new OperationError(
        "Request body is not valid JSON",
        "invalid_request",
        400,
      );
    }
    throw error;
  }
}
import { ZodError } from "zod";
