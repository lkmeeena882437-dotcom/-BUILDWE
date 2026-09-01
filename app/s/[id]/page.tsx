import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getShare } from "@/lib/db/store";
import { ShareView, type ShareDto } from "./ShareView";

/**
 * A share is read per request from a mutable store, so it must not be cached by the
 * framework: `force-dynamic` is what keeps a deleted link deleted on the next open.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = Promise<{ id: string }> | { id: string };

async function idOf(params: Params): Promise<string> {
  return (await params).id;
}

/** What a reader may see: user/assistant only, and no internal message meta. */
function toDto(share: NonNullable<ReturnType<typeof getShare>>): ShareDto {
  return {
    title: share.title,
    mode: share.mode,
    createdAt: share.createdAt,
    views: share.views,
    isArtifact: Boolean(share.artifactId),
    messages: share.messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
        createdAt: m.createdAt,
        sources: (m.meta as { sources?: { title: string; url: string; host: string }[] } | undefined)
          ?.sources,
      })),
  };
}

/**
 * The title and description a crawler or a link unfurler sees.
 *
 * This page used to be a client component that fetched its own content, so the HTML every
 * one of those readers received was an empty shell plus a spinner — and the unfurl card for
 * a shared creation was blank. Rendering on the server fixed the shell; `robots` is set here
 * because a shared conversation is public but must not be *indexed*: the link is the access
 * grant, and a search snippet of somebody's chat is a leak no one agreed to.
 */
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const share = getShare(await idOf(params));
  const robots = { index: false, follow: false } as const;
  if (!share) {
    return { title: "This shared link has no content · BUILDWE", robots };
  }
  const last = [...share.messages].reverse().find((m) => m.role === "assistant");
  const describe = (last?.content || share.title || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#*`>_~\[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return {
    title: `${share.title || "Shared chat"} · BUILDWE`,
    description: describe ? describe.slice(0, 155) : "A conversation shared on BUILDWE.",
    robots,
  };
}

export default async function SharePage({ params }: { params: Params }) {
  const share = getShare(await idOf(params));
  // A wrong or deleted id is a 404, which is what it has always meant. It used to answer
  // 200 with a client-side error box, so a stale link looked like a live page to every
  // tool that only reads the status line. A share whose only rows are system rows has
  // nothing a reader can be shown, so it is the same 404 rather than an empty page.
  if (!share) notFound();
  const dto = toDto(share);
  if (!dto.messages.length) notFound();
  return <ShareView share={dto} />;
}
