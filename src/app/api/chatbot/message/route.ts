import { NextRequest } from "next/server";
import { requireTenantContext } from "@/lib/server/tenant-context";
import { getOpenAIClient, CHAT_MODEL } from "@/lib/chatbot/openai";
import { buildSystemPrompt } from "@/lib/chatbot/system-prompt";
import { searchGuides } from "@/lib/chatbot/knowledge-base";
import type { ChatContext } from "@/lib/chatbot/system-prompt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const tenant = await requireTenantContext({}, req);
  if ("error" in tenant) return tenant.error;

  const body = await req.json();
  const { messages, currentPage } = body as {
    messages: { role: string; content: string }[];
    currentPage?: string;
  };

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return Response.json({ error: "Messages array is required" }, { status: 400 });
  }

  const lastMessage = messages[messages.length - 1]?.content || "";

  // Fetch user's employee name
  const { data: employee } = await tenant.admin
    .from("employees")
    .select("full_name")
    .eq("user_id", tenant.user.id)
    .eq("org_id", tenant.orgId)
    .maybeSingle();

  // Fetch org name
  const { data: org } = await tenant.admin
    .from("organizations")
    .select("name")
    .eq("id", tenant.orgId)
    .single();

  // Detect language from message
  const isArabic = /[؀-ۿ]/.test(lastMessage);

  const context: ChatContext = {
    userName: employee?.full_name || tenant.user.email || "User",
    userRole: tenant.role,
    orgName: org?.name || "Organization",
    currentPage: currentPage || "/",
    language: isArabic ? "ar" : "en",
  };

  // Search knowledge base for relevant guides
  const relevantGuides = searchGuides(lastMessage, tenant.role);
  let knowledgeContext = "";
  if (relevantGuides.length > 0) {
    const guidesText = relevantGuides
      .map((g) => {
        const steps = isArabic ? g.stepsAr : g.steps;
        return `### ${isArabic ? g.titleAr : g.title} (${g.module})\nRoute: ${g.route}\nRequired Roles: ${g.requiredRoles.join(", ")}\nSteps:\n${steps.map((s) => `${s.order}. ${s.instruction}${s.tip ? ` (💡 ${s.tip})` : ""}`).join("\n")}`;
      })
      .join("\n\n");
    knowledgeContext = `\n\n## Relevant Guides Found\n${guidesText}`;
  }

  const systemPrompt = buildSystemPrompt(context) + knowledgeContext;

  // Build OpenAI messages
  const openaiMessages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: systemPrompt },
    ...messages.map((msg) => ({
      role: msg.role as "user" | "assistant",
      content: msg.content,
    })),
  ];

  // Stream the response
  const stream = await getOpenAIClient().chat.completions.create({
    model: CHAT_MODEL,
    messages: openaiMessages,
    stream: true,
    max_tokens: 4096,
    temperature: 0.7,
  });

  const encoder = new TextEncoder();
  const responseStream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          const content = chunk.choices[0]?.delta?.content;
          if (content) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: "text", content })}\n\n`)
            );
          }
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`));
        controller.close();
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Stream error";
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "error", message })}\n\n`)
        );
        controller.close();
      }
    },
  });

  return new Response(responseStream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
