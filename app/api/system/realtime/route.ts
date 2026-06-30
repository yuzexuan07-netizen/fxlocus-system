export const dynamic = "force-dynamic";

const MIN_INTERVAL_MS = 3000;
const MAX_INTERVAL_MS = 30000;
const DEFAULT_INTERVAL_MS = 10000;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const intervalRaw = Number(url.searchParams.get("interval") || DEFAULT_INTERVAL_MS);
  const intervalMs = Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, intervalRaw || DEFAULT_INTERVAL_MS));

  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => {
        const payload = typeof data === "string" ? data : JSON.stringify(data);
        controller.enqueue(encoder.encode(`event: ${event}\n`));
        controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
      };

      controller.enqueue(encoder.encode(`retry: 5000\n\n`));
      send("open", { ts: Date.now() });
      timer = setInterval(() => {
        send("tick", { ts: Date.now() });
      }, intervalMs);
    },
    cancel() {
      if (timer) clearInterval(timer);
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    }
  });
}
