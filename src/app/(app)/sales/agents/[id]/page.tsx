import { AgentDetailScreen } from "@/components/field-agents/FieldAgentAdminScreens";

export default async function SalesAgentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AgentDetailScreen agentId={id} />;
}
