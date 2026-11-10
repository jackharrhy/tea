import { z } from "zod";

const TestAudienceSchema = z
  .object({
    testSubscriberIds: z.array(z.number().int().positive()).min(1).max(20),
  })
  .strict();

export function testSubscriberIds(
  audienceType: string,
  audienceData: string | null,
): number[] | null {
  if (audienceType !== "list" || !audienceData) return null;
  return TestAudienceSchema.parse(JSON.parse(audienceData)).testSubscriberIds;
}
