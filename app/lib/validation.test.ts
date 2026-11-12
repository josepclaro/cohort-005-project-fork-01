import { describe, it, expect } from "vitest";
import { z } from "zod";
import { parseFormData, parseJson } from "./validation";

const schema = z.object({ lessonId: z.number().int() });

function jsonRequest(body: string) {
  return new Request("http://localhost/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

async function statusOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return (error as { init: { status: number } | null }).init?.status;
  }
  throw new Error("Expected parseJson to throw");
}

describe("parseJson", () => {
  it("returns the parsed body", async () => {
    expect(await parseJson(jsonRequest('{"lessonId":3}'), schema)).toEqual({
      lessonId: 3,
    });
  });

  it("rejects a body that is not JSON with 400", async () => {
    expect(await statusOf(parseJson(jsonRequest("{not json"), schema))).toBe(
      400
    );
  });

  it("rejects JSON that does not match the schema with 400", async () => {
    expect(
      await statusOf(parseJson(jsonRequest('{"lessonId":"3"}'), schema))
    ).toBe(400);
  });
});

describe("parseFormData", () => {
  it("returns the first error for each failing field", () => {
    const formData = new FormData();
    formData.set("title", "");

    const result = parseFormData(
      formData,
      z.object({
        title: z.string().min(1, "Enter a title.").max(5, "Too long."),
        body: z.string({ required_error: "Enter a body." }),
      })
    );

    expect(result).toEqual({
      success: false,
      errors: { title: "Enter a title.", body: "Enter a body." },
    });
  });
});
