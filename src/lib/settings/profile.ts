import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const DEFAULT_PROFILE = `- 38 years old, based in Brooklyn, NYC
- MFA in Studio Art from Hunter College (2020), BS in Studio Art from Skidmore (2005-2010)
- Full-stack developer: React, Redux, Next.js, TypeScript, Ruby on Rails, Node.js, GraphQL, PostgreSQL, AWS, Kafka
- Currently Software Developer at Booz Allen Hamilton (2023-present): enterprise-scale VA applications, Kafka messaging systems, React modernization
- Previously Software Engineer at RGB Systems (2022-2023): client websites, Gatsby, Strapi, Shopify, WordPress
- Pre-tech: elementary school art teacher (~2011-2013), freelance art handler at NYC galleries/institutions (~2013-2021)
- Fabrication skills: laser cutting, vinyl cutting, 3D printing, SketchUp
- Design tools: Adobe Creative Suite
- Fine art practice: gallery exhibitions, painting, installation, mixed media, image transfer, silkscreen
- Conceptual coding projects: AI/LoRA generative art, datamosh video archive, collaborative drawing tools
- Has led projects but not managed people directly
- Salary floor: $110,000
- Wants: full-time, NYC or remote, hybrid OK. No freelance, no academia.`;

export async function getProfile(): Promise<string> {
  const row = await db.select().from(settings).where(eq(settings.key, "profile")).limit(1);
  return row[0]?.value ?? DEFAULT_PROFILE;
}
