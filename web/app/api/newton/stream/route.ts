import { newtonStream } from '../../../../lib/newton-stream';

export const dynamic = 'force-dynamic';

export async function GET() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Send initial result if available
      if (newtonStream.latestResult) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(newtonStream.latestResult)}\n\n`));
      }

      // Listen for new results
      const onResult = (result: typeof newtonStream.latestResult) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(result)}\n\n`));
        } catch {
          // Stream closed
          cleanup();
        }
      };

      // Keepalive every 15s to prevent proxy/browser timeout
      const keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': keepalive\n\n'));
        } catch {
          cleanup();
        }
      }, 15_000);

      function cleanup() {
        clearInterval(keepalive);
        newtonStream.removeListener(onResult);
      }

      newtonStream.addListener(onResult);

      // Handle client disconnect via AbortSignal isn't available here,
      // so we rely on the enqueue catch above to clean up
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
