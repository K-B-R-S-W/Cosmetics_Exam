export type AlertClient = { from(table: string): { insert(row: Record<string, unknown>): PromiseLike<{ error: { code?: string } | null }> } };

export async function createGradingAlert(client: AlertClient, input: {
  type: string; severity: "info" | "warning" | "critical"; message: string; uniqueKey: string;
}): Promise<"created" | "exists"> {
  const { error } = await client.from("alerts").insert({
    type: input.type, severity: input.severity, message: input.message, unique_key: input.uniqueKey,
  });
  if (!error) return "created";
  if (error.code === "23505") return "exists";
  throw new Error("database_error");
}
