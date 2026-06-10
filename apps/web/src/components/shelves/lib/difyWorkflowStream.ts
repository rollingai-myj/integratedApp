/**
 * Read a Dify workflow SSE stream and resolve with outputs when workflow_finished is received.
 * Works for all workflows/run calls in streaming mode.
 */
export async function readWorkflowFinished(response: Response): Promise<Record<string, unknown>> {
  if (!response.body) throw new Error("No response body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sepIdx: number;
      while ((sepIdx = buffer.indexOf("\n\n")) !== -1) {
        const chunk = buffer.slice(0, sepIdx);
        buffer = buffer.slice(sepIdx + 2);
        const dataLine = chunk.split("\n").find((l) => l.startsWith("data:"));
        if (!dataLine) continue;
        const dataStr = dataLine.slice(5).trim();
        if (!dataStr || dataStr === "[DONE]") continue;
        try {
          const evt = JSON.parse(dataStr) as {
            event?: string;
            data?: { status?: string; error?: string; outputs?: Record<string, unknown> };
            message?: string;
            code?: string;
          };
          if (evt.event === "workflow_finished") {
            reader.cancel();
            if (evt.data?.status === "failed") throw new Error(evt.data?.error || "Workflow failed");
            return evt.data?.outputs ?? {};
          }
          if (evt.event === "error") throw new Error(evt.message || evt.code || "Dify error");
        } catch (e) {
          if (e instanceof SyntaxError) continue;
          throw e;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  throw new Error("Stream ended without workflow_finished");
}
