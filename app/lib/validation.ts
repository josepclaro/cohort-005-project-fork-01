import { data } from "react-router";
import type { z } from "zod";

type ParseSuccess<T> = { success: true; data: T };
type ParseFailure = {
  success: false;
  errors: Record<string, string>;
};
type ParseResult<T> = ParseSuccess<T> | ParseFailure;

function firstErrorPerField(error: z.ZodError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const [key, messages] of Object.entries(error.flatten().fieldErrors)) {
    if (Array.isArray(messages) && messages.length > 0) {
      errors[key] = messages[0];
    }
  }
  return errors;
}

/**
 * Converts FormData to a plain object, validates with a Zod schema,
 * and returns either the parsed data or a field-error map (first error per field).
 */
export function parseFormData<T extends z.ZodType>(
  formData: FormData,
  schema: T
): ParseResult<z.infer<T>> {
  const result = schema.safeParse(Object.fromEntries(formData));

  if (result.success) {
    return { success: true, data: result.data };
  }

  return { success: false, errors: firstErrorPerField(result.error) };
}

/**
 * Validates route params with a Zod schema.
 * Throws a 400 response on failure (params are never user-correctable form errors).
 */
export function parseParams<T extends z.ZodType>(
  params: Record<string, string | undefined>,
  schema: T
): z.infer<T> {
  const result = schema.safeParse(params);

  if (result.success) {
    return result.data;
  }

  throw data("Invalid parameters", { status: 400 });
}

/**
 * Parses a JSON request body with a Zod schema.
 * Throws a 400 response when the body is not JSON or does not match — a JSON
 * body comes from our own scripts, not a form the user can correct.
 */
export async function parseJson<T extends z.ZodType>(
  request: Request,
  schema: T
): Promise<z.infer<T>> {
  const raw: unknown = await request.json().catch(() => undefined);
  const result = schema.safeParse(raw);

  if (result.success) {
    return result.data;
  }

  throw data("Invalid request body", { status: 400 });
}
