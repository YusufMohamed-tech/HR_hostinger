import { AgentDetailScreen } from "@/components/field-agents/FieldAgentAdminScreens";

export default function SalesAgentDetailPage({ params }: { params: { id: string } }) {
  return <AgentDetailScreen agentId={params.id} />;
}
