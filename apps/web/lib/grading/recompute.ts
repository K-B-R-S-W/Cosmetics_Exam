export type RpcLike = { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message?: string } | null }> };

export async function recomputeResults(client: RpcLike, attemptId: string): Promise<unknown> {
  const { data, error } = await client.rpc("recompute_results", { p_attempt_id: attemptId });
  if (error) throw new Error("database_error");
  return data;
}
