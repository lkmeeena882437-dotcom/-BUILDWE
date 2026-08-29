import { NextRequest, NextResponse } from "next/server";
import { detectIntent } from "@/lib/ai/rules";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const prompt = String(body.prompt || "");
  const mode = detectIntent(prompt);
  return NextResponse.json({ mode, prompt: prompt.slice(0, 200) });
}
