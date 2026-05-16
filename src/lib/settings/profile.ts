import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const DEFAULT_PROFILE = `## Identity
38 years old, based in Brooklyn, NYC. Hybrid creative-technologist by formation: a decade of fine-art + gallery / institutional work followed by ~4 years of professional software engineering. Sees code as an amplifier for creative, institutional, and conceptual thinking — not as the primary identity.

## Education
- MFA, Studio Art — Hunter College (2020)
- BS, Studio Art — Skidmore College (2005–2010)

## Professional engineering experience (~4 years)
- Software Developer, Booz Allen Hamilton (2023–present): enterprise-scale Veterans Affairs applications, Kafka messaging infrastructure, React modernization. Sprint-based delivery in a large consulting context.
- Software Engineer, RGB Systems (2022–2023): client work — Gatsby, Strapi, Shopify, WordPress.
- Stack: React, Redux, Next.js, TypeScript, Node.js, Ruby on Rails, GraphQL, PostgreSQL, AWS, Kafka.

## Art-world experience (~10 years pre-tech)
- Freelance art handler at NYC galleries and institutions (~2013–2021)
- Elementary school art teacher (~2011–2013)
- Active exhibiting artist: painting, installation, mixed-media, image transfer, silkscreen
- Fabrication: laser cutting, vinyl cutting, 3D printing, SketchUp
- Adobe Creative Suite proficient

## Creative-coding / conceptual projects
- AI / LoRA generative-art training pipelines
- Datamosh video archive
- Collaborative drawing tools
- Where the candidate's strongest differentiator lives: art-context + code together, applied to cultural/institutional/editorial problems.

## North star
Roles where creative, institutional, or conceptual thinking is the primary value, and coding is the amplifier. Best fit: museums, cultural institutions, auction houses, art-adjacent tech (Sotheby's, Christie's, 1stDibs, Artsy, Whitney, MoMA), experiential studios (Local Projects, Bluecadet, Deeplocal), media/editorial (NYT, Vox, Condé Nast, The Atlantic), design consultancies, design-forward tech.

## What he's NOT
- Not a senior engineer (~4 years professional engineering, not 7+).
- Not an AI/ML systems engineer. Uses Claude / Copilot / Cursor for development; that's AI-assisted coding, not building agentic UIs, training foundation models, or designing AI interaction paradigms.
- Not a UX researcher / interaction designer in a methodology sense. MFA is fine art, not HCI.
- Not a people manager. Has led projects but not managed direct reports.

## Constraints
- Full-time only. No freelance, no contract, no internship, no academia.
- Salary floor: $110,000.
- NYC or remote-US. Hybrid OK.`;

export async function getProfile(): Promise<string> {
  const row = await db.select().from(settings).where(eq(settings.key, "profile")).limit(1);
  return row[0]?.value ?? DEFAULT_PROFILE;
}
